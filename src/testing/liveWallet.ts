/**
 * Live CIP-30 wallet emulator for browser journey suites (Playwright).
 *
 * Real keys derived from a mnemonic (CIP-1852), real UTxOs from Blockfrost, real signatures, real
 * submission. It behaves like a real CIP-30 wallet on purpose:
 *   - getUtxos returns the FULL paginated UTxO set (no hidden/"parked" collateral),
 *   - getCollateral returns null (the common real-wallet case — the app must resolve collateral),
 *   - signTx returns a witness set holding ONLY this wallet's vkey witnesses (the app merges it),
 *   - signTx refuses non-canonical tx structure (hardware wallets / Eternl do).
 * Runs in Node; bridge it into a page with `installLiveCip30Wallet`.
 */
import { blake2b } from 'blakejs';
import { bech32 } from 'bech32';
import { assertCanonicalCbor } from '../tx';

const HARDENED = 0x80000000;

export type LiveNetwork = 'preview' | 'preprod' | 'mainnet';

export interface LiveWalletConfig {
    mnemonic: string;
    network: LiveNetwork;
    blockfrostApiKey: string;
    /** CIP-1852 account index (m/1852'/1815'/<account>'). Separate suites should use separate accounts so they never contend for UTxOs. */
    accountIndex?: number;
    /** When set, every submitted signed tx is written here for post-mortem. */
    submitDumpDir?: string;
    /** Injectable for tests. Defaults to global fetch. */
    fetchFn?: typeof fetch;
}

export interface LiveWallet {
    address: string;
    addressHex: string;
    rewardAddress: string;
    rewardAddressHex: string;
    networkId: number;
    paymentKeyHash: string;
    stakeKeyHash: string;
    dRepId: string;
    call: (method: string, params?: unknown) => Promise<unknown>;
    submittedTxHashes: string[];
    countUtxos: () => Promise<number>;
}

interface BlockfrostUtxo {
    tx_hash: string;
    output_index: number;
    amount: { unit: string; quantity: string }[];
    inline_datum?: string | null;
    data_hash?: string | null;
    _sourceAddr?: string;
}

let sdkPromise: Promise<{
    Cardano: typeof import('@cardano-sdk/core').Cardano;
    Serialization: typeof import('@cardano-sdk/core').Serialization;
    Crypto: typeof import('@cardano-sdk/crypto');
    bip39: typeof import('bip39');
}> | null = null;

// @cardano-sdk/crypto ships its own nested libsodium-wrappers-sumo; it must be `ready` before any
// Bip32 operation or it throws "libsodium was not correctly initialized".
const loadSdk = () => {
    sdkPromise ??= (async () => {
        const cryptoDir = require.resolve('@cardano-sdk/crypto').replace(/\/dist\/.*/, '');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sodium = require(require.resolve('libsodium-wrappers-sumo', { paths: [cryptoDir] }));
        await sodium.ready;
        const core = await import('@cardano-sdk/core');
        // Conway set tagging (tag 258) is required for valid tx CBOR on Conway networks.
        core.setInConwayEra(true);
        const Crypto = await import('@cardano-sdk/crypto');
        const bip39 = await import('bip39');
        return { Cardano: core.Cardano, Serialization: core.Serialization, Crypto, bip39 };
    })();
    return sdkPromise;
};

export const blockfrostBaseUrl = (network: LiveNetwork) => `https://cardano-${network}.blockfrost.io/api/v0`;


export const createLiveWallet = async (config: LiveWalletConfig): Promise<LiveWallet> => {
    const { Cardano, Serialization, Crypto, bip39 } = await loadSdk();
    const doFetch = config.fetchFn ?? fetch;
    const networkId = config.network === 'mainnet' ? 1 : 0;
    const base = blockfrostBaseUrl(config.network);
    const account = config.accountIndex ?? 0;

    const root = Crypto.Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39.mnemonicToEntropy(config.mnemonic), 'hex'), '');
    const accountKey = root.derive([1852 + HARDENED, 1815 + HARDENED, account + HARDENED]);
    const paymentKey = accountKey.derive([0, 0]).toRawKey();
    const stakeKey = accountKey.derive([2, 0]).toRawKey();
    const paymentKeyHash = paymentKey.toPublic().hash().hex();
    const stakeKeyHash = stakeKey.toPublic().hash().hex();

    const paymentCredential = { type: Cardano.CredentialType.KeyHash, hash: paymentKeyHash as never };
    const stakeCredential = { type: Cardano.CredentialType.KeyHash, hash: stakeKeyHash as never };
    const baseAddress = Cardano.BaseAddress.fromCredentials(networkId, paymentCredential, stakeCredential).toAddress();
    const address = baseAddress.toBech32();
    const addressHex = baseAddress.toBytes();
    // Some handle.me flows park tokens at EnterpriseAddress(stakeCredential); a real wallet owning
    // the stake key reports those UTxOs too.
    const enterpriseStakeAddress = Cardano.EnterpriseAddress.fromCredentials(networkId, stakeCredential).toAddress().toBech32();
    const rewardAddress = Cardano.RewardAccount.fromCredential(stakeCredential, networkId) as string;
    const rewardAddressHex = Cardano.Address.fromString(rewardAddress)!.toBytes();

    // CIP-95: DRep id = bech32('drep', 0x22 || blake2b-224(pubkey)).
    const dRepPubKeyHex = stakeKey.toPublic().hex();
    const dRepKeyHash = blake2b(Buffer.from(dRepPubKeyHex, 'hex'), undefined, 28);
    const dRepId = bech32.encode('drep', bech32.toWords(Uint8Array.from([0x22, ...dRepKeyHash])), 128);

    const submittedTxHashes: string[] = [];

    const fetchBlockfrost = async (path: string) => {
        const res = await doFetch(`${base}${path}`, { headers: { project_id: config.blockfrostApiKey } });
        if (!res.ok) throw new Error(`Blockfrost ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return res;
    };

    const fetchAddressUtxos = async (addr: string): Promise<BlockfrostUtxo[]> => {
        const all: BlockfrostUtxo[] = [];
        for (let page = 1; ; page++) {
            const res = await doFetch(`${base}/addresses/${addr}/utxos?count=100&page=${page}`, {
                headers: { project_id: config.blockfrostApiKey }
            });
            // 404 = the address has never been used — an empty set, not an error.
            if (res.status === 404) break;
            if (!res.ok) throw new Error(`Blockfrost /addresses/${addr}/utxos: ${res.status} ${(await res.text()).slice(0, 200)}`);
            const batch = (await res.json()) as BlockfrostUtxo[];
            for (const u of batch) u._sourceAddr = addr;
            all.push(...batch);
            if (batch.length < 100) break;
        }
        return all;
    };

    const utxoToCborHex = (u: BlockfrostUtxo): string => {
        const coins = BigInt(u.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');
        const assets = new Map<never, bigint>();
        for (const a of u.amount) if (a.unit !== 'lovelace') assets.set(a.unit as never, BigInt(a.quantity));
        const output = {
            address: u._sourceAddr ?? address,
            value: { coins, ...(assets.size > 0 ? { assets } : {}) },
            ...(u.inline_datum ? { datum: Serialization.PlutusData.fromCbor(u.inline_datum as never).toCore() } : {}),
            ...(!u.inline_datum && u.data_hash ? { datumHash: u.data_hash } : {})
        };
        return new Serialization.TransactionUnspentOutput(
            Serialization.TransactionInput.fromCore({ txId: u.tx_hash as never, index: u.output_index }),
            Serialization.TransactionOutput.fromCore(output as never)
        ).toCbor() as string;
    };

    const getUtxos = async (): Promise<string[]> => {
        const utxos = [...(await fetchAddressUtxos(address)), ...(await fetchAddressUtxos(enterpriseStakeAddress))];
        return utxos.map(utxoToCborHex);
    };

    const getBalance = async (): Promise<string> => {
        const utxos = await fetchAddressUtxos(address);
        const coins = utxos.reduce((sum, u) => sum + BigInt(u.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0'), BigInt(0));
        return Serialization.Value.fromCore({ coins }).toCbor() as string;
    };

    // The stake key must sign when it is a required signer, or when the tx spends/collateralizes a
    // UTxO whose PAYMENT credential is the stake key (EnterpriseAddress(stakeCredential)).
    const needsStakeKeySignature = async (body: ReturnType<InstanceType<typeof Serialization.TransactionBody>['toCore']>) => {
        if ((body.requiredExtraSignatures ?? []).some((s) => s === stakeKeyHash)) return true;
        const inputs = [...(body.inputs ?? []), ...(body.collaterals ?? [])];
        for (const input of inputs) {
            const res = await fetchBlockfrost(`/txs/${input.txId}/utxos`);
            const json = (await res.json()) as { outputs?: { address?: string; output_index?: number }[] };
            const out = json.outputs?.find((o, i) => (o.output_index ?? i) === input.index);
            if (out?.address === enterpriseStakeAddress) return true;
        }
        return false;
    };

    const signTx = async (txCborHex: string): Promise<string> => {
        assertCanonicalCbor(txCborHex, 'signTx');
        const tx = Serialization.Transaction.fromCbor(txCborHex as never);
        const bodyHash = tx.body().hash() as string;
        const signatures = new Map<never, never>();
        signatures.set(paymentKey.toPublic().hex() as never, paymentKey.sign(bodyHash as never).hex() as never);
        if (await needsStakeKeySignature(tx.body().toCore())) {
            signatures.set(stakeKey.toPublic().hex() as never, stakeKey.sign(bodyHash as never).hex() as never);
        }
        return Serialization.TransactionWitnessSet.fromCore({ signatures } as never).toCbor() as string;
    };

    const signTxs = async (txs: (string | { cbor?: string; tx?: string })[]): Promise<string[]> => {
        const out: string[] = [];
        for (const entry of txs) out.push(await signTx(typeof entry === 'string' ? entry : ((entry.cbor ?? entry.tx) as string)));
        return out;
    };

    const submitTx = async (signedTxCbor: string): Promise<string> => {
        if (config.submitDumpDir) {
            const fs = await import('node:fs');
            const path = await import('node:path');
            fs.mkdirSync(config.submitDumpDir, { recursive: true });
            fs.writeFileSync(path.join(config.submitDumpDir, `submit-${Date.now()}.cbor.hex`), signedTxCbor);
        }
        // Retry only transient failures (429/5xx). Any other 4xx is a real ledger rejection and
        // surfaces immediately with Blockfrost's full reason.
        const backoffsMs = [0, 1000, 4000, 10000];
        let lastError = '';
        for (const wait of backoffsMs) {
            if (wait) await new Promise((r) => setTimeout(r, wait));
            const res = await doFetch(`${base}/tx/submit`, {
                method: 'POST',
                headers: { project_id: config.blockfrostApiKey, 'Content-Type': 'application/cbor' },
                body: Buffer.from(signedTxCbor, 'hex')
            });
            const text = await res.text();
            if (res.ok) {
                const hash = text.replace(/"/g, '');
                submittedTxHashes.push(hash);
                return hash;
            }
            lastError = `${res.status} ${text.slice(0, 4000)}`;
            if (!(res.status === 429 || res.status >= 500)) break;
        }
        throw new Error(`Submit failed: ${lastError}`);
    };

    // CIP-8 COSE_Sign1 over the payload with the payment key (CIP-30 signData).
    const signData = async (addrHex: string, payloadHex: string): Promise<{ signature: string; key: string }> => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cms = require('@emurgo/cardano-message-signing-nodejs');
        const protectedHeaders = cms.HeaderMap.new();
        protectedHeaders.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
        protectedHeaders.set_header(cms.Label.new_text('address'), cms.CBORValue.new_bytes(Buffer.from(addrHex, 'hex')));
        const headers = cms.Headers.new(cms.ProtectedHeaderMap.new(protectedHeaders), cms.HeaderMap.new());
        const builder = cms.COSESign1Builder.new(headers, Buffer.from(payloadHex, 'hex'), false);
        const toSign = Buffer.from(builder.make_data_to_sign().to_bytes()).toString('hex');
        const coseSign1 = builder.build(Buffer.from(paymentKey.sign(toSign as never).hex(), 'hex'));

        const coseKey = cms.COSEKey.new(cms.Label.from_key_type(cms.KeyType.OKP));
        coseKey.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
        coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-1)), cms.CBORValue.from_label(cms.Label.from_curve_type(cms.CurveType.Ed25519)));
        coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-2)), cms.CBORValue.new_bytes(Buffer.from(paymentKey.toPublic().hex(), 'hex')));
        return {
            signature: Buffer.from(coseSign1.to_bytes()).toString('hex'),
            key: Buffer.from(coseKey.to_bytes()).toString('hex')
        };
    };

    const call = async (method: string, params?: unknown): Promise<unknown> => {
        switch (method) {
            case 'getUtxos':
                return getUtxos();
            case 'getCollateral':
                return null;
            case 'getBalance':
                return getBalance();
            case 'getNetworkId':
                return networkId;
            case 'getRewardAddresses':
                return [rewardAddressHex];
            case 'getChangeAddress':
                return addressHex;
            case 'getUsedAddresses':
                return [addressHex];
            case 'getUnusedAddresses':
                return [];
            case 'getExtensions':
                return [{ cip: 8 }, { cip: 95 }, { cip: 103 }];
            case 'signTx':
                return signTx(params as string);
            case 'signTxs':
                return signTxs(params as string[]);
            case 'signData': {
                const p = params as { addr: string; payload: string };
                return signData(p.addr, p.payload);
            }
            case 'submitTx':
                return submitTx(params as string);
            case 'getPubDRepKey':
                return dRepPubKeyHex;
            default:
                throw new Error(`Unknown CIP-30 method: ${method}`);
        }
    };

    return {
        address,
        addressHex,
        rewardAddress,
        rewardAddressHex,
        networkId,
        paymentKeyHash,
        stakeKeyHash,
        dRepId,
        call,
        submittedTxHashes,
        countUtxos: async () => (await fetchAddressUtxos(address)).length
    };
};

