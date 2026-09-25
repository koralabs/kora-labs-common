// Local UPLC work on scalus (optional peer dependency, loaded on first use): applying parameters to a
// compiled validator (replaces Helios' UplcProgram.apply) and evaluating a tx's scripts offline.
// Production code evaluates with the node (BlockfrostTxClient.evaluateTx); the local evaluator is for
// tests and tooling that must run without a network.
import { Cardano, Serialization } from '@cardano-sdk/core';
import { ExUnits } from './fees';
import { Evaluator, RedeemerKey } from './scriptTx';

type ScalusModule = {
    Scalus: {
        applyDataArgToScript: (doubleCborHex: string, dataJson: string) => string;
        evalPlutusScripts: (tx: Uint8Array, utxos: Uint8Array, slotConfig: unknown, costModels: number[][]) => { tag: string; index: number; budget: { memory: bigint; steps: bigint } }[];
    };
    SlotConfig: Record<'mainnet' | 'preview' | 'preprod', unknown>;
};

let scalusModule: ScalusModule | undefined;
// Lazy: scalus is an optional peer, needed only by callers of these helpers.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const scalus = (): ScalusModule => (scalusModule ??= require('scalus') as ScalusModule);

const cborByteStringHeader = (length: number): Buffer => {
    if (length <= 23) return Buffer.from([0x40 | length]);
    if (length <= 0xff) return Buffer.from([0x58, length]);
    if (length <= 0xffff) return Buffer.from([0x59, length >> 8, length & 0xff]);
    return Buffer.from([0x5a, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
};

/** [header length, content length] of the CBOR byte string at the start of `bytes`. */
const byteStringHeader = (bytes: Buffer): [number, number] => {
    if (bytes.length === 0 || bytes[0] >> 5 !== 2) throw new Error('expected a CBOR byte string');
    const info = bytes[0] & 0x1f;
    if (info <= 23) return [1, info];
    if (info === 24) return [2, bytes[1]];
    if (info === 25) return [3, bytes.readUInt16BE(1)];
    if (info === 26) return [5, bytes.readUInt32BE(1)];
    throw new Error(`unsupported CBOR byte string header 0x${bytes[0].toString(16)}`);
};

const isDoubleCbor = (bytes: Buffer) => {
    const [headerLength] = byteStringHeader(bytes);
    return bytes[headerLength] >> 5 === 2;
};

/**
 * Scripts come in two forms: "single CBOR" — a CBOR byte string of the flat program, as Aiken
 * blueprints, Blockfrost `/scripts/{hash}/cbor` and cardano-sdk's `PlutusScript.bytes` hold it — and
 * "double CBOR" — that wrapped once more, as scalus reads and writes it.
 */
export const toDoubleCbor = (cborHex: string): string => {
    const bytes = Buffer.from(cborHex, 'hex');
    return isDoubleCbor(bytes) ? cborHex : Buffer.concat([cborByteStringHeader(bytes.length), bytes]).toString('hex');
};

export const toSingleCbor = (cborHex: string): string => {
    const bytes = Buffer.from(cborHex, 'hex');
    if (!isDoubleCbor(bytes)) return cborHex;
    const [headerLength, length] = byteStringHeader(bytes);
    return bytes.subarray(headerLength, headerLength + length).toString('hex');
};

/** Plutus data in the node's JSON form (what scalus.applyDataArgToScript reads). */
export const plutusDataToJson = (data: Serialization.PlutusData): unknown => {
    const c = data.asConstrPlutusData();
    if (c) {
        const fields = c.getData();
        return { constructor: Number(c.getAlternative()), fields: Array.from({ length: fields.getLength() }, (_, i) => plutusDataToJson(fields.get(i))) };
    }
    const bytes = data.asBoundedBytes();
    if (bytes) return { bytes: Buffer.from(bytes).toString('hex') };
    const integer = data.asInteger();
    if (integer !== undefined) {
        if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`integer parameter ${integer} is outside the safe range scalus accepts`);
        return { int: Number(integer) };
    }
    const items = data.asList();
    if (items) return { list: Array.from({ length: items.getLength() }, (_, i) => plutusDataToJson(items.get(i))) };
    const map = data.asMap();
    if (map) {
        const keys = map.getKeys();
        return { map: Array.from({ length: keys.getLength() }, (_, i) => ({ k: plutusDataToJson(keys.get(i)), v: plutusDataToJson(map.get(keys.get(i))!) })) };
    }
    throw new Error('unsupported Plutus data');
};

/** Apply parameters (in order) to a compiled validator; returns the script in single-CBOR form. */
export const applyParamsToScript = (compiledCode: string, params: Serialization.PlutusData[]): string =>
    toSingleCbor(params.reduce((script, param) => scalus().Scalus.applyDataArgToScript(script, JSON.stringify(plutusDataToJson(param))), toDoubleCbor(compiledCode)));

/** A Plutus script (single- or double-CBOR) as a cardano-sdk Script. */
export const plutusScript = (cborHex: string, version: Cardano.PlutusLanguageVersion): Cardano.PlutusScript => ({
    __type: Cardano.ScriptType.Plutus,
    version,
    bytes: toSingleCbor(cborHex) as Cardano.PlutusScript['bytes']
});

/** The script hash of a (single- or double-CBOR) Plutus script of `version`. */
export const plutusScriptHash = (cborHex: string, version: Cardano.PlutusLanguageVersion): string =>
    Serialization.Script.fromCore(plutusScript(cborHex, version)).hash();

const PURPOSE: Record<string, string> = { spend: 'spend', mint: 'mint', cert: 'certificate', certificate: 'certificate', reward: 'withdrawal', withdraw: 'withdrawal', withdrawal: 'withdrawal' };

/**
 * An Evaluator that runs the tx's scripts locally (scalus) against `utxos` — every spent AND
 * referenced UTxO, reference scripts included. Offline stand-in for the node's evaluation.
 */
export const localEvaluator = ({
    utxos,
    costModels,
    network
}: {
    utxos: Cardano.Utxo[];
    costModels: Map<Cardano.PlutusLanguageVersion, number[]>;
    network: 'mainnet' | 'preview' | 'preprod';
}): Evaluator => {
    const writer = new Serialization.CborWriter();
    writer.writeStartMap(utxos.length);
    for (const [txIn, txOut] of utxos) {
        writer.writeEncodedValue(Buffer.from(Serialization.TransactionInput.fromCore(txIn).toCbor(), 'hex'));
        writer.writeEncodedValue(Buffer.from(Serialization.TransactionOutput.fromCore(txOut).toCbor(), 'hex'));
    }
    const utxoCbor = writer.encode();
    const models = [Cardano.PlutusLanguageVersion.V1, Cardano.PlutusLanguageVersion.V2, Cardano.PlutusLanguageVersion.V3].map((v) => costModels.get(v) ?? []);
    return async (txCbor: string) => {
        const { Scalus, SlotConfig } = scalus();
        const results = Scalus.evalPlutusScripts(Buffer.from(txCbor, 'hex'), utxoCbor, SlotConfig[network], models);
        return new Map<RedeemerKey, ExUnits>(
            results.map((r) => [`${PURPOSE[String(r.tag).toLowerCase()] ?? String(r.tag).toLowerCase()}:${r.index}`, { memory: Number(r.budget.memory), steps: Number(r.budget.steps) }])
        );
    };
};
