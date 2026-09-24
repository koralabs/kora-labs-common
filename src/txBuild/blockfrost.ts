// Blockfrost access for building/evaluating/submitting script transactions, returning @cardano-sdk/core
// types. Every call goes through the shared rate-limited transport (fetchProviderJson), which honors
// Retry-After and friends process-wide.
import { Cardano, Serialization } from '@cardano-sdk/core';
import { fetchProviderJson, ProviderRequestOptions } from '../chain/transport/fetchProviderJson';
import { ExUnits, ratio } from './fees';
import { RedeemerKey, ScriptTxProtocolParameters } from './scriptTx';

type BlockfrostAmount = { unit: string; quantity: string }[];
interface BlockfrostUtxo {
    address?: string;
    tx_hash?: string;
    output_index: number;
    amount: BlockfrostAmount;
    data_hash?: string | null;
    inline_datum?: string | null;
    reference_script_hash?: string | null;
    consumed_by_tx?: string | null;
}

export interface BlockfrostScript {
    hash: string;
    language: Cardano.PlutusLanguageVersion | 'native';
    /** Serialized size (the ledger's reference-script size). */
    size: number;
    script?: Cardano.Script;
}

const PLUTUS_LANGUAGE: Record<string, Cardano.PlutusLanguageVersion> = {
    plutusV1: Cardano.PlutusLanguageVersion.V1,
    plutusV2: Cardano.PlutusLanguageVersion.V2,
    plutusV3: Cardano.PlutusLanguageVersion.V3
};

const OGMIOS_PURPOSE: Record<string, string> = {
    spend: 'spend',
    mint: 'mint',
    certificate: 'certificate',
    withdrawal: 'withdrawal',
    withdraw: 'withdrawal',
    reward: 'withdrawal'
};

export class BlockfrostEvaluationError extends Error {
    constructor(public readonly failure: unknown) {
        super(`Transaction failed evaluation: ${JSON.stringify(failure)}`);
        this.name = 'BlockfrostEvaluationError';
    }
}

export const valueFromBlockfrost = (amount: BlockfrostAmount): Cardano.Value => {
    let coins = BigInt(0);
    const assets = new Map<Cardano.AssetId, bigint>();
    for (const { unit, quantity } of amount) {
        if (unit === 'lovelace') coins = BigInt(quantity);
        else assets.set(Cardano.AssetId.fromParts(Cardano.PolicyId(unit.slice(0, 56)), Cardano.AssetName(unit.slice(56))), BigInt(quantity));
    }
    return { coins, ...(assets.size ? { assets } : {}) };
};

/** Additional-UTxO shape Blockfrost's evaluator accepts: Ogmios value `{ ada: { lovelace }, [policy]: { [asset]: qty } }`. */
export const toOgmiosUtxo = ([txIn, txOut]: Cardano.Utxo) => {
    const value: Record<string, Record<string, number>> = { ada: { lovelace: Number(txOut.value.coins) } };
    for (const [id, qty] of txOut.value.assets ?? []) {
        const policy = Cardano.AssetId.getPolicyId(id);
        value[policy] = { ...(value[policy] ?? {}), [Cardano.AssetId.getAssetName(id)]: Number(qty) };
    }
    return [
        { txId: txIn.txId, index: txIn.index },
        {
            address: txOut.address,
            value,
            ...(txOut.datum ? { datum: Serialization.PlutusData.fromCore(txOut.datum).toCbor() } : {}),
            ...(txOut.datumHash ? { datumHash: txOut.datumHash } : {})
        }
    ];
};

export class BlockfrostTxClient {
    private readonly scripts = new Map<string, Promise<BlockfrostScript>>();
    private readonly host: string;

    constructor(private readonly config: { network: string; blockfrostApiKey: string; fetcher?: ProviderRequestOptions['fetcher'] }) {
        this.host = `https://cardano-${config.network.toLowerCase()}.blockfrost.io/api/v0`;
    }

    private request<T>(path: string, init: { method?: string; body?: string | Uint8Array; contentType?: string } = {}): Promise<T> {
        return fetchProviderJson<T>({
            provider: 'Blockfrost',
            url: `${this.host}/${path.replace(/^\//, '')}`,
            method: init.method ?? 'GET',
            headers: { project_id: this.config.blockfrostApiKey, 'Content-Type': init.contentType ?? 'application/json' },
            body: init.body,
            fetcher: this.config.fetcher,
            // Submission/evaluation are not idempotent-safe to blind-retry on 5xx; rate limits are still honored.
            ...(init.method === 'POST' ? { maxRetries: 0 } : {})
        });
    }

    private async getOrNull<T>(path: string): Promise<T | null> {
        try {
            return await this.request<T>(path);
        } catch (error: any) {
            if (error?.status === 404) return null;
            throw error;
        }
    }

    async getProtocolParameters(): Promise<ScriptTxProtocolParameters> {
        const p = await this.request<Record<string, any>>('epochs/latest/parameters');
        const raw = p.cost_models_raw as Record<string, number[]> | undefined;
        if (!raw) throw new Error('Protocol parameters carry no cost_models_raw');
        // cost_models_raw is the LEDGER-ordered array; the named `cost_models` object is not (its
        // alphabetical order produced script_data_hash mismatches once the models were extended).
        const costModels = new Map<Cardano.PlutusLanguageVersion, number[]>();
        for (const [name, model] of Object.entries(raw)) {
            const language = PLUTUS_LANGUAGE[name.charAt(0).toLowerCase() + name.slice(1)];
            if (language !== undefined) costModels.set(language, model);
        }
        return {
            minFeeA: BigInt(p.min_fee_a),
            minFeeB: BigInt(p.min_fee_b),
            priceMemory: ratio(p.price_mem),
            priceSteps: ratio(p.price_step),
            minFeeRefScriptCostPerByte: ratio(p.min_fee_ref_script_cost_per_byte ?? 0),
            coinsPerUtxoByte: BigInt(p.coins_per_utxo_size),
            maxTxSize: Number(p.max_tx_size),
            maxTxExUnits: { memory: Number(p.max_tx_ex_mem), steps: Number(p.max_tx_ex_steps) },
            costModels
        };
    }

    getLatestBlock(): Promise<{ slot: number; time: number; hash: string; height: number }> {
        return this.request('blocks/latest');
    }

    /** Slot of a POSIX time (ms), from the tip (1-second slots since Shelley on every network). */
    async slotAt(posixMs: number): Promise<number> {
        const tip = await this.getLatestBlock();
        return tip.slot + Math.floor((posixMs - tip.time * 1000) / 1000);
    }

    getScript(hash: string): Promise<BlockfrostScript> {
        let cached = this.scripts.get(hash);
        if (!cached) {
            cached = (async () => {
                const info = await this.request<{ type: string; serialised_size: number | null }>(`scripts/${hash}`);
                if (info.type === 'timelock') return { hash, language: 'native' as const, size: Number(info.serialised_size ?? 0) };
                const language = PLUTUS_LANGUAGE[info.type];
                if (language === undefined) throw new Error(`Unknown script type ${info.type} for ${hash}`);
                const { cbor } = await this.request<{ cbor: string }>(`scripts/${hash}/cbor`);
                // Blockfrost's `cbor` is the script as the ledger hashes it (a CBOR byte string of the flat program).
                const script: Cardano.Script = { __type: Cardano.ScriptType.Plutus, version: language, bytes: cbor as never };
                if (Serialization.Script.fromCore(script).hash() !== hash) throw new Error(`Script ${hash} CBOR does not hash to ${hash}`);
                return { hash, language, size: Number(info.serialised_size ?? cbor.length / 2), script };
            })();
            cached.catch(() => this.scripts.delete(hash));
            this.scripts.set(hash, cached);
        }
        return cached;
    }

    private async toUtxo(item: BlockfrostUtxo, txHash: string, address: string): Promise<Cardano.Utxo> {
        const scriptReference = item.reference_script_hash ? (await this.getScript(item.reference_script_hash)).script : undefined;
        return [
            { txId: Cardano.TransactionId(txHash), index: item.output_index, address: address as Cardano.PaymentAddress },
            {
                address: address as Cardano.PaymentAddress,
                value: valueFromBlockfrost(item.amount),
                ...(item.inline_datum ? { datum: Serialization.PlutusData.fromCbor(item.inline_datum as never).toCore() } : {}),
                ...(!item.inline_datum && item.data_hash ? { datumHash: item.data_hash as Cardano.TxOut['datumHash'] } : {}),
                ...(scriptReference ? { scriptReference } : {})
            }
        ];
    }

    /** Every UTxO at `address` (paginated). */
    async getAddressUtxos(address: string): Promise<Cardano.Utxo[]> {
        const utxos: Cardano.Utxo[] = [];
        for (let page = 1; ; page++) {
            const items = (await this.getOrNull<BlockfrostUtxo[]>(`addresses/${address}/utxos?page=${page}&count=100`)) ?? [];
            for (const item of items) utxos.push(await this.toUtxo(item, item.tx_hash!, address));
            if (items.length < 100) return utxos;
        }
    }

    /** UTxOs at `address` holding `unit`. */
    async getAddressAssetUtxos(address: string, unit: string): Promise<Cardano.Utxo[]> {
        const items = (await this.getOrNull<BlockfrostUtxo[]>(`addresses/${address}/utxos/${unit}`)) ?? [];
        return Promise.all(items.map((item) => this.toUtxo(item, item.tx_hash!, address)));
    }

    /** The UTxO `txHash#index`; throws `already spent` when it has been consumed. */
    async getUtxo(ref: string): Promise<Cardano.Utxo> {
        const [txHash, index] = ref.split('#');
        const tx = await this.request<{ outputs: BlockfrostUtxo[] }>(`txs/${txHash}/utxos`);
        const output = tx.outputs.find((o) => o.output_index === Number(index));
        if (!output) throw new Error(`${ref} does not exist`);
        if (output.consumed_by_tx) throw new Error(`${ref} already spent by ${output.consumed_by_tx}`);
        return this.toUtxo(output, txHash, output.address!);
    }

    /** Node (Ogmios) evaluation of every redeemer; `additionalUtxos` supplies inputs not yet on chain. */
    async evaluateTx(cbor: string, additionalUtxos: Cardano.Utxo[] = []): Promise<Map<RedeemerKey, ExUnits>> {
        const response = await this.request<{ result?: { EvaluationResult?: Record<string, { memory: number; steps: number }>; EvaluationFailure?: unknown }; fault?: unknown }>(
            'utils/txs/evaluate/utxos',
            { method: 'POST', body: JSON.stringify({ cbor, additionalUtxoSet: additionalUtxos.map(toOgmiosUtxo) }) }
        );
        const result = response.result?.EvaluationResult;
        if (!result) throw new BlockfrostEvaluationError(response.result?.EvaluationFailure ?? response.fault ?? response);
        const units = new Map<RedeemerKey, ExUnits>();
        for (const [pointer, { memory, steps }] of Object.entries(result)) {
            const [purpose, index] = pointer.split(':');
            units.set(`${OGMIOS_PURPOSE[purpose] ?? purpose}:${index}`, { memory, steps });
        }
        return units;
    }

    /** Submit a signed tx; returns its hash. */
    submitTx(cbor: string): Promise<string> {
        return this.request<string>('tx/submit', { method: 'POST', body: Buffer.from(cbor, 'hex'), contentType: 'application/cbor' });
    }
}
