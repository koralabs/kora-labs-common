/**
 * On-chain EFFECT assertions for live journey suites. Chain truth via Blockfrost — never the
 * indexer or the UI. Each assertion throws on mismatch so the calling scope fails. Blockfrost is
 * reached through the shared rate-limited transport (./blockfrost).
 */
import cbor from 'cbor';
import { RateLimitedError } from '../chain/transport/rateLimit';
import { BlockfrostAccess, blockfrostGet } from './blockfrost';

export const LBL_222 = '000de140'; // CIP-68 user/owner NFT
export const LBL_100 = '000643b0'; // CIP-68 reference token
export const LBL_000 = '00000000'; // virtual subhandle token
export const LBL_444 = '001bc280'; // CIP-68 RFT

export const hexOf = (s: string) => Buffer.from(s, 'utf8').toString('hex');

export type ChainConfig = BlockfrostAccess;

export interface TxUtxoOutput {
    address: string;
    amount: { unit: string; quantity: string }[];
    output_index: number;
    inline_datum?: string | null;
    data_hash?: string | null;
    consumed_by_tx?: string | null;
}

export interface TxUtxos {
    hash: string;
    inputs: (TxUtxoOutput & { tx_hash: string })[];
    outputs: TxUtxoOutput[];
}

const getJson = async <T>(chain: ChainConfig, path: string): Promise<T> => {
    const found = await blockfrostGet<T>(chain, path);
    if (found === null) throw new Error(`onChain: GET ${path} failed (404)`);
    return found;
};

export const fetchTxUtxos = (chain: ChainConfig, txHash: string) => getJson<TxUtxos>(chain, `/txs/${txHash}/utxos`);

export const lovelaceOf = (amount: { unit: string; quantity: string }[]) => BigInt(amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');

export interface TxConfirmation {
    confirmed: boolean;
    block?: string;
    validContract?: boolean;
}

/**
 * Poll until the tx is in a block AND Blockfrost serves its UTxOs. Right after inclusion Blockfrost can
 * answer /txs/<hash> while /txs/<hash>/utxos still 404s (seen on preview: the live suite's reads right
 * after "confirmed" failed), so "confirmed" means every follow-up read of the tx will answer.
 * A tx in a block with `valid_contract: false` is NOT a success.
 */
export const waitForTxConfirmation = async (chain: ChainConfig, txHash: string, timeoutMs = 180_000, pollMs = 5_000): Promise<TxConfirmation> => {
    const start = Date.now();
    // A transient provider failure is another poll; a rate limit too long to sit out is returned.
    const poll = <T>(path: string) =>
        blockfrostGet<T>(chain, path).catch((error) => {
            if (error instanceof RateLimitedError) throw error;
            return null;
        });
    for (;;) {
        const data = await poll<{ block: string; valid_contract: boolean }>(`/txs/${txHash}`);
        if (data && (await poll(`/txs/${txHash}/utxos`))) return { confirmed: true, block: data.block, validContract: data.valid_contract };
        if (Date.now() - start >= timeoutMs) return { confirmed: false };
        await new Promise((r) => setTimeout(r, pollMs));
    }
};

/** Poll a tx output until it is spent; returns the spending tx hash, or null on timeout. */
export const waitForOutputConsumed = async (
    chain: ChainConfig,
    txHash: string,
    outputIndex: number,
    timeoutMs: number,
    pollMs = 15_000
): Promise<string | null> => {
    const start = Date.now();
    for (;;) {
        const utxos = await fetchTxUtxos(chain, txHash);
        const out = utxos.outputs.find((o) => o.output_index === outputIndex);
        if (!out) throw new Error(`onChain: ${txHash}#${outputIndex} does not exist`);
        if (out.consumed_by_tx) return out.consumed_by_tx;
        if (Date.now() - start >= timeoutMs) return null;
        await new Promise((r) => setTimeout(r, pollMs));
    }
};

/** Assert `<policy><label><name>` exists with quantity > 0 and, optionally, that another label does NOT exist. */
export const assertCip68Label = async (chain: ChainConfig, policyId: string, name: string, opts: { hasLabel: string; notLabel?: string }) => {
    const nameHex = hexOf(name);
    const present = await blockfrostGet<{ quantity?: string }>(chain, `/assets/${policyId}${opts.hasLabel}${nameHex}`);
    if (!present) throw new Error(`onChain: expected asset ${opts.hasLabel}+${name} under ${policyId} (not found)`);
    const quantity = BigInt(present.quantity ?? '0');
    if (quantity <= BigInt(0)) throw new Error(`onChain: asset ${opts.hasLabel}+${name} has zero quantity`);
    if (opts.notLabel) {
        const forbidden = await blockfrostGet<{ quantity?: string }>(chain, `/assets/${policyId}${opts.notLabel}${nameHex}`);
        const fq = BigInt(forbidden?.quantity ?? '0');
        if (fq > BigInt(0)) throw new Error(`onChain: asset ${opts.notLabel}+${name} must NOT exist (quantity ${fq})`);
    }
};

/** Assert an asset's total on-chain quantity is 0 (burned). */
export const assertAssetBurned = async (chain: ChainConfig, assetUnit: string) => {
    const asset = await blockfrostGet<{ quantity?: string }>(chain, `/assets/${assetUnit}`);
    if (!asset) return;
    const quantity = asset.quantity ?? '0';
    if (BigInt(quantity) !== BigInt(0)) throw new Error(`onChain: expected ${assetUnit} burned, quantity is ${quantity}`);
};

/** Assert a tx paid at least `minLovelace` (summed over outputs) to `toAddress`. */
export const assertAdaTransfer = async (chain: ChainConfig, txHash: string, toAddress: string, minLovelace: bigint) => {
    const { outputs } = await fetchTxUtxos(chain, txHash);
    const paid = outputs.filter((o) => o.address === toAddress).reduce((sum, o) => sum + lovelaceOf(o.amount), BigInt(0));
    if (paid < minLovelace) throw new Error(`onChain: tx ${txHash} paid ${paid} lovelace to ${toAddress}, expected >= ${minLovelace}`);
    return paid;
};

/** Resolve an output's datum CBOR hex (inline, or by hash). */
export const fetchOutputDatumCbor = async (chain: ChainConfig, output: TxUtxoOutput): Promise<string> => {
    if (output.inline_datum) return output.inline_datum;
    if (output.data_hash) return (await getJson<{ cbor: string }>(chain, `/scripts/datum/${output.data_hash}/cbor`)).cbor;
    throw new Error(`onChain: output #${output.output_index} carries no datum`);
};

/** Decode the CIP-68 `extra` map (constr field 2) from the output of `txHash` that holds `<label><name>`. */
export const fetchCip68ExtraFromTx = async (chain: ChainConfig, txHash: string, name: string, label = LBL_100): Promise<Map<Buffer, unknown>> => {
    const { outputs } = await fetchTxUtxos(chain, txHash);
    const suffix = `${label}${hexOf(name)}`;
    const out = outputs.find((o) => o.amount.some((a) => a.unit.endsWith(suffix)));
    if (!out) throw new Error(`onChain: no ${label} output for ${name} in ${txHash}`);
    const decoded = cbor.decodeFirstSync(Buffer.from(await fetchOutputDatumCbor(chain, out), 'hex')) as { value?: unknown[] };
    const extra = decoded.value?.[2];
    if (!(extra instanceof Map)) throw new Error('onChain: CIP-68 datum has no extra map');
    return extra as Map<Buffer, unknown>;
};

/** Read a scalar field from a decoded CIP-68 map (metadata or extra). */
export const cip68Field = (map: Map<Buffer, unknown>, key: string): string | null => {
    for (const [k, v] of map.entries()) {
        if (!Buffer.isBuffer(k) || k.toString('utf8') !== key) continue;
        if (Buffer.isBuffer(v)) return v.toString('utf8');
        if (v == null) return null;
        if (v instanceof Map || Array.isArray(v)) return JSON.stringify(v);
        return String(v);
    }
    return null;
};
