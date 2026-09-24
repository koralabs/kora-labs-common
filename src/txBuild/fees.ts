// Exact Conway fee / deposit arithmetic (BigInt rationals — no floating point anywhere a ledger rule
// uses a ratio). Pure: no network, no cardano-sdk.

/** A non-negative rational n/d. */
export interface Ratio {
    n: bigint;
    d: bigint;
}

/** Exact rational from a decimal number/string as providers report it (0.0577, "0.0000721", 7.21e-5). */
export const ratio = (value: number | string | bigint): Ratio => {
    if (typeof value === 'bigint') return { n: value, d: BigInt(1) };
    const text = typeof value === 'number' ? value.toString() : value.trim();
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) throw new Error(`Not a non-negative decimal: ${value}`);
    const [, whole, fraction = '', exponent = '0'] = match;
    let n = BigInt(whole + fraction);
    let d = BigInt(10) ** BigInt(fraction.length);
    const exp = Number(exponent);
    if (exp > 0) n *= BigInt(10) ** BigInt(exp);
    if (exp < 0) d *= BigInt(10) ** BigInt(-exp);
    return { n, d };
};

const ceilDiv = (n: bigint, d: bigint) => (n + d - BigInt(1)) / d;

export interface FeeParameters {
    /** min_fee_a (lovelace per byte) */
    minFeeA: bigint;
    /** min_fee_b (constant lovelace) */
    minFeeB: bigint;
    priceMemory: Ratio;
    priceSteps: Ratio;
    /** min_fee_ref_script_cost_per_byte (Conway) */
    minFeeRefScriptCostPerByte: Ratio;
}

export interface ExUnits {
    memory: number | bigint;
    steps: number | bigint;
}

/** ceiling(priceMem * Σmem + priceSteps * Σsteps) — the ledger prices the TOTAL, then rounds once. */
export const scriptExecutionFee = (params: Pick<FeeParameters, 'priceMemory' | 'priceSteps'>, exUnits: ExUnits[]): bigint => {
    const memory = exUnits.reduce((sum, e) => sum + BigInt(e.memory), BigInt(0));
    const steps = exUnits.reduce((sum, e) => sum + BigInt(e.steps), BigInt(0));
    const { priceMemory: pm, priceSteps: ps } = params;
    return ceilDiv(pm.n * memory * ps.d + ps.n * steps * pm.d, pm.d * ps.d);
};

const REF_SCRIPT_SIZE_INCREMENT = BigInt(25_600);
const REF_SCRIPT_MULTIPLIER: Ratio = { n: BigInt(6), d: BigInt(5) };

/**
 * Conway's tiered reference-script fee: every 25,600 bytes the per-byte price is multiplied by 1.2;
 * the sum is floored. `totalBytes` counts every reference script of every spent AND referenced input.
 */
export const referenceScriptFee = (costPerByte: Ratio, totalBytes: number | bigint): bigint => {
    let remaining = BigInt(totalBytes);
    let price = costPerByte;
    let acc: Ratio = { n: BigInt(0), d: BigInt(1) };
    const add = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
    while (remaining >= REF_SCRIPT_SIZE_INCREMENT) {
        acc = add(acc, { n: price.n * REF_SCRIPT_SIZE_INCREMENT, d: price.d });
        price = { n: price.n * REF_SCRIPT_MULTIPLIER.n, d: price.d * REF_SCRIPT_MULTIPLIER.d };
        remaining -= REF_SCRIPT_SIZE_INCREMENT;
    }
    acc = add(acc, { n: price.n * remaining, d: price.d });
    return acc.n / acc.d;
};

/** The ledger minimum fee for a tx of `sizeBytes` (as submitted, witnesses included). */
export const minFee = (params: FeeParameters, sizeBytes: number, exUnits: ExUnits[], referenceScriptBytes: number): bigint =>
    params.minFeeA * BigInt(sizeBytes) +
    params.minFeeB +
    scriptExecutionFee(params, exUnits) +
    referenceScriptFee(params.minFeeRefScriptCostPerByte, referenceScriptBytes);

/** Babbage/Conway min-UTxO: (160 + |serialized output|) * coinsPerUtxoByte. */
export const minAdaForOutputSize = (coinsPerUtxoByte: bigint, outputSizeBytes: number): bigint =>
    (BigInt(160) + BigInt(outputSizeBytes)) * coinsPerUtxoByte;
