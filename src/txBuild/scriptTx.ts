// Deterministic Plutus transaction finalizer on @cardano-sdk/core (no input selection, no Helios).
//
// The caller fixes every input; this module derives redeemer pointers from the ledger's canonical
// orderings, tops outputs up to min-UTxO, asks the NODE (via `evaluate`) for each redeemer's
// execution units, converges the fee to the exact ledger minimum, puts the remainder in one change
// output, and computes script_data_hash over the exact redeemer bytes it serializes.
//
// Lessons baked in (handle.me docs/spec/live-tx-lessons-learned.md):
//  - Conway redeemers are map-encoded; script_data_hash must hash the bytes actually shipped (#1).
//  - inline datums never enter script_data_hash (#2).
//  - reference inputs / inputs / policies / withdrawals are indexed in ledger-sorted order (#3).
//  - execution units come from the node's evaluator, re-checked after the fee settles (the fee and
//    change are part of the ScriptContext, so a fee change can change the cost).
import { Cardano, Serialization, setInConwayEra } from '@cardano-sdk/core';
import { blake2bHex } from 'blakejs';
import { mergeWitnessSet } from '../tx';
import { ExUnits, FeeParameters, minAdaForOutputSize, minFee } from './fees';

setInConwayEra(true);

export type PlutusData = Serialization.PlutusData;

export interface ScriptTxProtocolParameters extends FeeParameters {
    coinsPerUtxoByte: bigint;
    /** key_deposit: what a (pre-Conway-style) stake registration certificate locks. */
    stakeKeyDeposit: bigint;
    maxTxSize: number;
    maxTxExUnits: { memory: number; steps: number };
    /** Ledger-ordered cost models (Blockfrost `cost_models_raw`), keyed by Plutus language. */
    costModels: Map<Cardano.PlutusLanguageVersion, number[]>;
}

export interface ScriptTxPlan {
    /** Every spent input, resolved. A redeemer marks a Plutus script spend. */
    inputs: { utxo: Cardano.Utxo; redeemer?: PlutusData }[];
    referenceInputs?: Cardano.TxIn[];
    collateral?: Cardano.TxIn[];
    /** Kept in this order. Outputs below min-UTxO are topped up to it. */
    outputs: Cardano.TxOut[];
    /** One entry per policy. A redeemer marks a Plutus policy (native policies need `nativeScripts`). */
    mint?: { policyId: string; assets: Map<string, bigint>; redeemer?: PlutusData }[];
    withdrawals?: { rewardAccount: string; quantity: bigint; redeemer?: PlutusData }[];
    /** Stake (de)registrations; their deposits/refunds are balanced into the change. No certificate redeemers. */
    certificates?: Cardano.Certificate[];
    requiredSigners?: string[];
    nativeScripts?: Cardano.NativeScript[];
    validityInterval?: Cardano.ValidityInterval;
    changeAddress: string;
    /** vkey witnesses the signed tx will carry (sizes the fee). */
    signerCount: number;
    /** Languages of every Plutus script the tx runs (from their reference scripts). */
    plutusLanguages: Cardano.PlutusLanguageVersion[];
    /** Σ size of every reference script on spent + referenced inputs (Conway ref-script fee). */
    referenceScriptBytes: number;
}

/** Redeemer pointer key: `${purpose}:${index}` (e.g. `spend:1`, `mint:0`, `withdrawal:0`). */
export type RedeemerKey = string;
export type Evaluator = (unsignedTxCbor: string) => Promise<Map<RedeemerKey, ExUnits>>;

export interface FinalizedScriptTx {
    /** Unsigned tx CBOR (empty vkey witness set). */
    cbor: string;
    txId: string;
    fee: bigint;
    /** Final outputs, change last. */
    outputs: Cardano.TxOut[];
    redeemers: Cardano.Redeemer[];
}

const byTxIn = (a: Cardano.TxIn, b: Cardano.TxIn) => (a.txId === b.txId ? a.index - b.index : a.txId < b.txId ? -1 : 1);
const hexCompare = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const rewardAccountBytes = (account: string) => Cardano.Address.fromBech32(account).toBytes();

const outputSize = (output: Cardano.TxOut) => Serialization.TransactionOutput.fromCore(output).toCbor().length / 2;

/** Raise `output` to its min-UTxO (the coin's own CBOR width is part of the size, so iterate). */
export const withMinAda = (output: Cardano.TxOut, coinsPerUtxoByte: bigint): Cardano.TxOut => {
    let current = output;
    for (let i = 0; i < 5; i++) {
        const required = minAdaForOutputSize(coinsPerUtxoByte, outputSize(current));
        if (current.value.coins >= required) return current;
        current = { ...current, value: { ...current.value, coins: required } };
    }
    throw new Error('min-UTxO did not converge');
};

/**
 * script_data_hash = blake2b-256(redeemers ‖ datums? ‖ language_views), over the exact bytes of the
 * serialized witness-set fields. `datumsCbor` is only for witness-set datums (never inline datums).
 */
export const computeScriptDataHash = ({
    redeemersCbor,
    datumsCbor,
    costModels,
    languages
}: {
    redeemersCbor?: string;
    datumsCbor?: string;
    costModels: Map<Cardano.PlutusLanguageVersion, number[]>;
    languages: Cardano.PlutusLanguageVersion[];
}): string | undefined => {
    if (!redeemersCbor && !datumsCbor) return undefined;
    const views = new Serialization.Costmdls();
    for (const language of new Set(languages)) {
        const model = costModels.get(language);
        if (!model) throw new Error(`No cost model for Plutus language ${language}`);
        views.insert(new Serialization.CostModel(language, model));
    }
    const EMPTY_MAP = 'a0';
    const preimage = redeemersCbor ? redeemersCbor + (datumsCbor ?? '') + views.languageViewsEncoding() : EMPTY_MAP + datumsCbor + EMPTY_MAP;
    return blake2bHex(Buffer.from(preimage, 'hex'), undefined, 32);
};

const placeholderSignatures = (count: number) => {
    const signatures = new Map<string, string>();
    for (let i = 0; i < count; i++) signatures.set((i + 1).toString(16).padStart(64, '0'), '0'.repeat(128));
    return signatures;
};

/** Lovelace a certificate locks (positive) or releases (negative). */
export const certificateDeposit = (certificate: Cardano.Certificate, stakeKeyDeposit: bigint): bigint => {
    switch (certificate.__typename) {
        case Cardano.CertificateType.StakeRegistration:
            return stakeKeyDeposit;
        case Cardano.CertificateType.StakeDeregistration:
            return -stakeKeyDeposit;
        case Cardano.CertificateType.Registration:
            return certificate.deposit;
        case Cardano.CertificateType.Unregistration:
            return -certificate.deposit;
        default:
            throw new Error(`Certificate ${certificate.__typename} is not supported by finalizeScriptTx`);
    }
};

const sumValues = (values: Cardano.Value[]) => {
    let coins = BigInt(0);
    const assets = new Map<Cardano.AssetId, bigint>();
    for (const value of values) {
        coins += value.coins;
        for (const [id, qty] of value.assets ?? []) assets.set(id, (assets.get(id) ?? BigInt(0)) + qty);
    }
    return { coins, assets };
};

/** The inputs cannot pay the outputs + fee (+ a min-UTxO change output); `shortfall` more lovelace would. */
export class InsufficientInputsError extends Error {
    constructor(message: string, public readonly shortfall: bigint) {
        super(message);
        this.name = 'InsufficientInputsError';
    }
}

export const finalizeScriptTx = async (plan: ScriptTxPlan, params: ScriptTxProtocolParameters, evaluate: Evaluator): Promise<FinalizedScriptTx> => {
    const inputs = [...plan.inputs].sort((a, b) => byTxIn(a.utxo[0], b.utxo[0]));
    const mint = [...(plan.mint ?? [])].sort((a, b) => hexCompare(a.policyId, b.policyId));
    const withdrawals = [...(plan.withdrawals ?? [])].sort((a, b) => hexCompare(rewardAccountBytes(a.rewardAccount), rewardAccountBytes(b.rewardAccount)));
    const outputs = plan.outputs.map((output) => withMinAda(output, params.coinsPerUtxoByte));

    const pointers: { purpose: Cardano.RedeemerPurpose; index: number; data: PlutusData }[] = [
        ...inputs.flatMap(({ redeemer }, index) => (redeemer ? [{ purpose: Cardano.RedeemerPurpose.spend, index, data: redeemer }] : [])),
        ...mint.flatMap(({ redeemer }, index) => (redeemer ? [{ purpose: Cardano.RedeemerPurpose.mint, index, data: redeemer }] : [])),
        ...withdrawals.flatMap(({ redeemer }, index) => (redeemer ? [{ purpose: Cardano.RedeemerPurpose.withdrawal, index, data: redeemer }] : []))
    ];
    const key = (purpose: string, index: number): RedeemerKey => `${purpose}:${index}`;

    const tokenMap = new Map<Cardano.AssetId, bigint>();
    for (const { policyId, assets } of mint) {
        for (const [name, qty] of assets) tokenMap.set(Cardano.AssetId.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(name)), qty);
    }
    const inValue = sumValues(inputs.map(({ utxo }) => utxo[1].value));
    const withdrawn = withdrawals.reduce((sum, w) => sum + w.quantity, BigInt(0));
    const deposited = (plan.certificates ?? []).reduce((sum, c) => sum + certificateDeposit(c, params.stakeKeyDeposit), BigInt(0));
    const produced = sumValues(outputs.map((o) => o.value));

    const changeFor = (fee: bigint): Cardano.TxOut => {
        const coins = inValue.coins + withdrawn - deposited - produced.coins - fee;
        if (coins < BigInt(0)) throw new InsufficientInputsError(`Inputs do not cover outputs + fee: ${-coins} lovelace short`, -coins);
        const assets = new Map<Cardano.AssetId, bigint>();
        const ids = new Set([...inValue.assets.keys(), ...tokenMap.keys(), ...produced.assets.keys()]);
        for (const id of ids) {
            const qty = (inValue.assets.get(id) ?? BigInt(0)) + (tokenMap.get(id) ?? BigInt(0)) - (produced.assets.get(id) ?? BigInt(0));
            if (qty < BigInt(0)) throw new Error(`Outputs carry more ${id} than the inputs and mint provide`);
            if (qty > BigInt(0)) assets.set(id, qty);
        }
        return { address: plan.changeAddress as Cardano.PaymentAddress, value: { coins, ...(assets.size ? { assets } : {}) } };
    };

    const assemble = (fee: bigint, exUnits: Map<RedeemerKey, ExUnits>, signatures: Map<string, string>) => {
        const change = changeFor(fee);
        const redeemers: Cardano.Redeemer[] = pointers.map(({ purpose, index, data }) => {
            const units = exUnits.get(key(purpose, index));
            if (!units) throw new Error(`No execution units for redeemer ${key(purpose, index)}`);
            return { purpose, index, data: data.toCore(), executionUnits: { memory: Number(units.memory), steps: Number(units.steps) } };
        });
        const redeemersCbor = redeemers.length ? Serialization.Redeemers.fromCore(redeemers).toCbor() : undefined;
        const scriptIntegrityHash = computeScriptDataHash({ redeemersCbor, costModels: params.costModels, languages: plan.plutusLanguages });
        const body: Cardano.TxBody = {
            inputs: inputs.map(({ utxo: [txIn] }) => ({ txId: txIn.txId, index: txIn.index })),
            outputs: [...outputs, change],
            fee,
            ...(plan.referenceInputs?.length ? { referenceInputs: [...plan.referenceInputs].sort(byTxIn) } : {}),
            ...(plan.collateral?.length ? { collaterals: [...plan.collateral].sort(byTxIn) } : {}),
            ...(tokenMap.size ? { mint: tokenMap } : {}),
            ...(plan.certificates?.length ? { certificates: plan.certificates } : {}),
            ...(withdrawals.length ? { withdrawals: withdrawals.map((w) => ({ stakeAddress: w.rewardAccount as Cardano.RewardAccount, quantity: w.quantity })) } : {}),
            ...(plan.requiredSigners?.length ? { requiredExtraSignatures: [...new Set(plan.requiredSigners)].sort(hexCompare) as NonNullable<Cardano.TxBody['requiredExtraSignatures']> } : {}),
            ...(plan.validityInterval ? { validityInterval: plan.validityInterval } : {}),
            ...(scriptIntegrityHash ? { scriptIntegrityHash: scriptIntegrityHash as Cardano.TxBody['scriptIntegrityHash'] } : {})
        };
        const tx = Serialization.Transaction.fromCore({
            id: '0'.repeat(64) as Cardano.TransactionId,
            body,
            witness: {
                signatures: signatures as Cardano.Signatures,
                ...(redeemers.length ? { redeemers } : {}),
                ...(plan.nativeScripts?.length ? { scripts: plan.nativeScripts } : {})
            },
            isValid: true
        } as Cardano.Tx);
        return { tx, change, redeemers };
    };

    // Evaluation budget placeholder: the node evaluates against the protocol maximum, not the declared units.
    const share = Math.max(1, pointers.length);
    const placeholder = new Map(pointers.map(({ purpose, index }) => [key(purpose, index), {
        memory: Math.floor(params.maxTxExUnits.memory / share),
        steps: Math.floor(params.maxTxExUnits.steps / share)
    }]));
    const sizeOf = (fee: bigint, exUnits: Map<RedeemerKey, ExUnits>) =>
        assemble(fee, exUnits, placeholderSignatures(plan.signerCount)).tx.toCbor().length / 2;

    let exUnits = pointers.length ? await evaluate(assemble(BigInt(0), placeholder, new Map()).tx.toCbor()) : new Map<RedeemerKey, ExUnits>();
    let fee = BigInt(0);
    for (let round = 0; round < 6; round++) {
        // Converge the fee for these units: the fee's own CBOR width changes the size it pays for.
        for (let i = 0; i < 6; i++) {
            const needed = minFee(params, sizeOf(fee, exUnits), [...exUnits.values()], plan.referenceScriptBytes);
            if (needed <= fee) break;
            fee = needed;
        }
        if (!pointers.length) break;
        // The fee and change are part of the ScriptContext: re-evaluate the tx we would actually submit.
        const reevaluated = await evaluate(assemble(fee, exUnits, new Map()).tx.toCbor());
        const unchanged = [...reevaluated].every(([k, u]) => {
            const prior = exUnits.get(k);
            return prior && BigInt(prior.memory) === BigInt(u.memory) && BigInt(prior.steps) === BigInt(u.steps);
        });
        exUnits = reevaluated;
        if (unchanged && minFee(params, sizeOf(fee, exUnits), [...exUnits.values()], plan.referenceScriptBytes) <= fee) break;
        if (round === 5) throw new Error('Execution units did not converge');
    }

    const { tx, change, redeemers } = assemble(fee, exUnits, new Map());
    const changeMinAda = minAdaForOutputSize(params.coinsPerUtxoByte, outputSize(change));
    if (change.value.coins < changeMinAda) {
        throw new InsufficientInputsError(
            `Inputs do not cover outputs + fee: change of ${change.value.coins} lovelace is below min-UTxO`,
            changeMinAda - change.value.coins
        );
    }
    const signedSize = sizeOf(fee, exUnits);
    if (signedSize > params.maxTxSize) throw new Error(`Transaction is ${signedSize} bytes, above the ${params.maxTxSize} byte limit`);
    return { cbor: tx.toCbor(), txId: tx.getId(), fee, outputs: [...outputs, change], redeemers };
};

/**
 * Wallet inputs for a tx whose other inputs are fixed: ADA-only UTxOs first, largest first, until they
 * hold `lovelace` (callers include a fee/min-UTxO allowance; the finalizer returns the excess as change).
 * UTxOs carrying tokens are only used when ADA-only ones do not suffice (their tokens go to change).
 */
export const selectWalletInputs = (utxos: Cardano.Utxo[], lovelace: bigint, exclude: Set<string> = new Set()): Cardano.Utxo[] => {
    const key = ([txIn]: Cardano.Utxo) => `${txIn.txId}#${txIn.index}`;
    const candidates = utxos
        .filter((u) => !exclude.has(key(u)))
        .sort((a, b) => {
            const tokensA = a[1].value.assets?.size ? 1 : 0;
            const tokensB = b[1].value.assets?.size ? 1 : 0;
            if (tokensA !== tokensB) return tokensA - tokensB;
            return a[1].value.coins === b[1].value.coins ? 0 : a[1].value.coins > b[1].value.coins ? -1 : 1;
        });
    const selected: Cardano.Utxo[] = [];
    let total = BigInt(0);
    for (const utxo of candidates) {
        if (total >= lovelace) break;
        selected.push(utxo);
        total += utxo[1].value.coins;
    }
    if (total < lovelace) throw new Error(`Wallet holds ${total} spendable lovelace; ${lovelace} needed`);
    return selected;
};

const coinsOf = (utxos: Cardano.Utxo[]) => utxos.reduce((sum, [, out]) => sum + out.value.coins, BigInt(0));

export interface WalletFundedPlan extends Omit<ScriptTxPlan, 'inputs' | 'signerCount'> {
    /** Inputs the tx spends regardless of funding (scripts, tokens being moved); none for a plain payment. */
    inputs?: ScriptTxPlan['inputs'];
    /**
     * The wallet's UTxOs exactly as the wallet handed them over (CIP-30 `getUtxos`), which may include
     * its own UNCONFIRMED change (tx chaining). They are never looked up on chain.
     */
    walletUtxos: Cardano.Utxo[];
    /** vkey witnesses the signed tx carries once these wallet inputs are chosen. */
    signerCount: (walletInputs: Cardano.Utxo[]) => number;
}

/**
 * Coin selection + finalization in one: walks the `selectWalletInputs` order (ADA-only first, largest
 * first) one UTxO at a time and returns the first selection `finalizeScriptTx` can balance: inputs
 * covering outputs + fee with a min-UTxO change output. Pure: no chain reads, so chained (unconfirmed)
 * wallet UTxOs are spendable. Throws `InsufficientInputsError` (shortfall vs. the whole wallet) when
 * no selection works.
 */
export const finalizeWalletFundedTx = async (
    { walletUtxos, signerCount, inputs = [], ...plan }: WalletFundedPlan,
    params: ScriptTxProtocolParameters,
    evaluate: Evaluator
): Promise<FinalizedScriptTx & { walletInputs: Cardano.Utxo[] }> => {
    const available = coinsOf(walletUtxos);
    let required = plan.outputs.reduce((sum, o) => sum + o.value.coins, BigInt(0));
    // Each selection is the previous one plus the next UTxO in order (+1 lovelace past its total).
    for (let lovelace = BigInt(1); lovelace <= available; ) {
        const walletInputs = selectWalletInputs(walletUtxos, lovelace);
        const selected = coinsOf(walletInputs);
        try {
            const tx = await finalizeScriptTx(
                { ...plan, inputs: [...inputs, ...walletInputs.map((utxo) => ({ utxo }))], signerCount: signerCount(walletInputs) },
                params,
                evaluate
            );
            return { ...tx, walletInputs };
        } catch (error) {
            if (!(error instanceof InsufficientInputsError)) throw error;
            required = selected + error.shortfall;
            lovelace = selected + BigInt(1);
        }
    }
    throw new InsufficientInputsError(`Wallet holds ${available} spendable lovelace; about ${required} needed`, required - available);
};

/**
 * Add vkey witnesses to an unsigned tx by splicing them into its witness set byte-for-byte
 * (`mergeWitnessSet`): the body (so the tx id and every signature) and the redeemer bytes the
 * script_data_hash covers are untouched.
 */
export const addVkeyWitnesses = (unsignedCbor: string, witnesses: { vkey: string; signature: string }[]): string => {
    const witnessSet = Serialization.TransactionWitnessSet.fromCore({
        signatures: new Map(witnesses.map(({ vkey, signature }) => [vkey, signature])) as Cardano.Signatures
    });
    return mergeWitnessSet(unsignedCbor, witnessSet.toCbor());
};
