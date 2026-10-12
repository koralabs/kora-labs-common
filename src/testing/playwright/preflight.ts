/**
 * Live-suite preflight. Fails LOUD — there is no bypass — when the environment cannot produce a
 * meaningful run (unreachable provider, unfunded wallet, stalled backend). A green run on a broken
 * environment is the false pass these suites exist to prevent.
 */
import { blockfrostGet, BlockfrostAccess } from '../blockfrost';
import { addressHoldings } from '../onChain';

export interface PreflightCheckResult {
    name: string;
    ok: boolean;
    detail: string;
}

export interface PreflightResult {
    ok: boolean;
    checks: PreflightCheckResult[];
}

/** A check resolves to its detail line when healthy and throws (with the reason) when not. */
export interface PreflightCheck {
    name: string;
    run(): Promise<string>;
}

/** Runs every check (one failure does not hide the others). */
export const runPreflightChecks = async (checks: PreflightCheck[]): Promise<PreflightResult> => {
    const results: PreflightCheckResult[] = [];
    for (const check of checks) {
        try {
            results.push({ name: check.name, ok: true, detail: await check.run() });
        } catch (error) {
            results.push({ name: check.name, ok: false, detail: (error as Error)?.message ?? String(error) });
        }
    }
    return { ok: results.every((r) => r.ok), checks: results };
};

/** Prints every check and throws when any failed. */
export const assertPreflight = (result: PreflightResult, log: (line: string) => void = console.log) => {
    for (const c of result.checks) log(`preflight ${c.ok ? 'OK' : 'FAIL'}: ${c.name} — ${c.detail}`);
    if (!result.ok) {
        const failed = result.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
        throw new Error(`Preflight failed — the environment is not ready. This is fatal and has NO bypass; fix the environment and re-run.\n  ${failed.join('\n  ')}`);
    }
};

export const blockfrostReachableCheck = (chain: BlockfrostAccess): PreflightCheck => ({
    name: 'blockfrost reachable',
    run: async () => {
        if (!(await blockfrostGet(chain, '/network'))) throw new Error('GET /network -> 404');
        return `${chain.network} /network OK`;
    }
});

/** The address holds at least `minLovelace`. `fundHint` tells the operator how to top it up. */
export const walletFundedCheck = (chain: BlockfrostAccess, address: string, minLovelace: bigint, fundHint = ''): PreflightCheck => ({
    name: 'suite wallet funded',
    run: async () => {
        const balance = (await addressHoldings(chain, address)).get('lovelace') ?? BigInt(0);
        if (balance < minLovelace) throw new Error(`${address} has ${balance} lovelace; needs ${minLovelace}.${fundHint ? ` ${fundHint}` : ''}`);
        return `${balance} lovelace >= ${minLovelace}`;
    }
});
