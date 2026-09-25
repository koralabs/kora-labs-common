/**
 * Live CIP-30 wallet emulator for browser journey suites (Playwright).
 *
 * Real keys derived from a mnemonic (CIP-1852), real UTxOs from Blockfrost, real signatures, real
 * submission. It behaves like a real CIP-30 wallet on purpose:
 *   - getUtxos returns the FULL paginated UTxO set (no hidden/"parked" collateral),
 *   - it CHAINS like Eternl/Lace: once it has submitted a tx, getUtxos (and getBalance, and the
 *     signing-key choice) return that tx's outputs to this wallet and drop the inputs it spent, until
 *     the tx is in a block — then chain truth takes over. A dapp therefore receives UTxOs that exist
 *     on no provider yet, exactly as real users' wallets hand them over (HAL minting depends on it),
 *   - getCollateral returns null (the common real-wallet case — the app must resolve collateral),
 *   - signTx returns a witness set holding ONLY this wallet's vkey witnesses (the app merges it),
 *   - signTx refuses non-canonical tx structure (hardware wallets / Eternl do).
 * Runs in Node; bridge it into a page with `installLiveCip30Wallet`.
 */
import { blake2b } from 'blakejs';
import { bech32 } from 'bech32';
import { assertCanonicalCbor, txHashFromCbor } from '../tx';
import { blockfrostGet, blockfrostSubmit, LiveNetwork } from './blockfrost';

const HARDENED = 0x80000000;

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

/** One tx this wallet submitted, with the chaining facts a suite asserts on. */
export interface LiveSubmission {
    txHash: string;
    /** Local clock (ms) when the submission was accepted. */
    submittedAt: number;
    /**
     * Inputs (`txHash#index`) that were outputs of this wallet's OWN earlier submissions that were not
     * in a block yet when this tx was submitted — i.e. the tx is chained on unconfirmed change.
     */
    chainedInputs: string[];
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
    /** Every accepted submission, in order (`submittedTxHashes` is the hash-only view). */
    submissions: LiveSubmission[];
    /** Hashes of submitted txs this wallet has not yet seen in a block. */
    pendingTxHashes: () => string[];
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

export const createLiveWallet = async (config: LiveWalletConfig): Promise<LiveWallet> => {
    const { Cardano, Serialization, Crypto, bip39 } = await loadSdk();
    const access = { network: config.network, blockfrostApiKey: config.blockfrostApiKey, fetchFn: config.fetchFn };
    const networkId = config.network === 'mainnet' ? 1 : 0;
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

    const ownAddresses = new Set([address, enterpriseStakeAddress]);

    const submittedTxHashes: string[] = [];
    const submissions: LiveSubmission[] = [];

    // ── Chaining state: this wallet's submitted txs that are not in a block yet ─────────────────
    // `spends` are the inputs it consumed; `outputs` are its outputs back to this wallet (exact
    // ledger CBOR, keyed `txHash#index`, with the address so the signer choice can use them).
    interface PendingTx {
        spends: Set<string>;
        outputs: Map<string, { cbor: string; address: string; lovelace: bigint }>;
    }
    const pending = new Map<string, PendingTx>();

    const fetchAddressUtxos = async (addr: string): Promise<BlockfrostUtxo[]> => {
        const all: BlockfrostUtxo[] = [];
        for (let page = 1; ; page++) {
            // null (404) = the address has never been used — an empty set, not an error.
            const batch = await blockfrostGet<BlockfrostUtxo[]>(access, `/addresses/${addr}/utxos?count=100&page=${page}`);
            if (!batch) break;
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

    /** A pending tx that is now in a block leaves the overlay: chain truth takes over. */
    const settlePending = async () => {
        for (const txHash of [...pending.keys()]) {
            if (await blockfrostGet(access, `/txs/${txHash}`)) pending.delete(txHash);
        }
    };

    interface OwnUtxo {
        cbor: string;
        address: string;
        lovelace: bigint;
    }

    /** The wallet's own view: chain UTxOs, minus what its pending txs spent, plus their unspent change. */
    const ownUtxos = async (): Promise<Map<string, OwnUtxo>> => {
        await settlePending();
        const chainUtxos = [...(await fetchAddressUtxos(address)), ...(await fetchAddressUtxos(enterpriseStakeAddress))];
        const spent = new Set([...pending.values()].flatMap((p) => [...p.spends]));
        const view = new Map<string, OwnUtxo>();
        for (const u of chainUtxos) {
            const ref = `${u.tx_hash}#${u.output_index}`;
            if (spent.has(ref)) continue;
            view.set(ref, { cbor: utxoToCborHex(u), address: u._sourceAddr ?? address, lovelace: BigInt(u.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0') });
        }
        for (const p of pending.values()) {
            for (const [ref, out] of p.outputs) if (!spent.has(ref)) view.set(ref, out);
        }
        return view;
    };

    const getUtxos = async (): Promise<string[]> => [...(await ownUtxos()).values()].map((u) => u.cbor);

    const getBalance = async (): Promise<string> => {
        const coins = [...(await ownUtxos()).values()].filter((u) => u.address === address).reduce((sum, u) => sum + u.lovelace, BigInt(0));
        return Serialization.Value.fromCore({ coins }).toCbor() as string;
    };

    // The stake key must sign when it is a required signer, or when the tx spends/collateralizes one of
    // this wallet's UTxOs whose PAYMENT credential is the stake key (EnterpriseAddress(stakeCredential)).
    // Resolved from the wallet's own view, like a real wallet: chained inputs are on no provider yet.
    const needsStakeKeySignature = async (body: ReturnType<InstanceType<typeof Serialization.TransactionBody>['toCore']>) => {
        if ((body.requiredExtraSignatures ?? []).some((s) => s === stakeKeyHash)) return true;
        const inputs = [...(body.inputs ?? []), ...(body.collaterals ?? [])];
        if (inputs.length === 0) return false;
        const view = await ownUtxos();
        return inputs.some((input) => view.get(`${input.txId}#${input.index}`)?.address === enterpriseStakeAddress);
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

    /** Record an accepted submission: its spent inputs leave the view, its own outputs join it. */
    const trackSubmitted = (txHash: string, signedTxCbor: string) => {
        const body = Serialization.Transaction.fromCbor(signedTxCbor as never).body();
        const spends = new Set(body.inputs().values().map((i) => `${i.transactionId()}#${Number(i.index())}`));
        const chainedInputs = [...spends].filter((ref) => pending.has(ref.split('#')[0]));
        const outputs = new Map<string, OwnUtxo>();
        body.outputs().forEach((output, index) => {
            const outAddress = output.address().toBech32();
            if (!ownAddresses.has(outAddress)) return;
            const cbor = new Serialization.TransactionUnspentOutput(Serialization.TransactionInput.fromCore({ txId: txHash as never, index }), output).toCbor() as string;
            outputs.set(`${txHash}#${index}`, { cbor, address: outAddress, lovelace: output.amount().coin() });
        });
        pending.set(txHash, { spends, outputs });
        submittedTxHashes.push(txHash);
        submissions.push({ txHash, submittedAt: Date.now(), chainedInputs });
    };

    const submitTx = async (signedTxCbor: string): Promise<string> => {
        if (config.submitDumpDir) {
            const fs = await import('node:fs');
            const path = await import('node:path');
            fs.mkdirSync(config.submitDumpDir, { recursive: true });
            fs.writeFileSync(path.join(config.submitDumpDir, `submit-${Date.now()}.cbor.hex`), signedTxCbor);
        }
        // Transient failures (5xx) are retried by the transport; rate limits wait exactly the stated
        // time; any other 4xx is a real ledger rejection and surfaces with Blockfrost's reason.
        const hash = await blockfrostSubmit(access, signedTxCbor);
        const expected = txHashFromCbor(signedTxCbor);
        if (hash !== expected) throw new Error(`Submit returned ${hash} for tx ${expected}`);
        trackSubmitted(hash, signedTxCbor);
        return hash;
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
        submissions,
        pendingTxHashes: () => [...pending.keys()],
        countUtxos: async () => [...(await ownUtxos()).values()].filter((u) => u.address === address).length
    };
};

