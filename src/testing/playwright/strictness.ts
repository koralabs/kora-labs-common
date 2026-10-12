/**
 * The live-suite strictness contract, enforced in code:
 *
 *   - `useOnChainEffectGate`: a scope passes only after it proved its on-chain EFFECT through
 *     `assertOnChainEffect`. An `afterEach` fails any scope that reached `passed` without one — a UI
 *     success state, a screenshot or "a tx landed" is necessary but never sufficient.
 *   - `defineLiveSuiteStrictness`: a meta-test (no wallet, no chain) that reads the suite source and fails
 *     if an escape hatch appears, the gate is not wired, the suite is not serial, or a scope body never
 *     proves an effect. Run it with the suite's local/pre-merge tests.
 *
 * `@playwright/test` is passed in (`test`), never imported at runtime.
 */
import { readFileSync } from 'node:fs';
import type { TestInfo, TestType } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTest = TestType<any, any>;

export const STRICTNESS_VIOLATION = 'STRICTNESS VIOLATION';

export interface OnChainEffectGateOptions {
    /** Scopes the run did not execute (e.g. resume-selection that returns early). They have nothing to verify. */
    exempt?: (testInfo: TestInfo) => boolean;
    log?: (line: string) => void;
}

export interface OnChainEffectGate {
    /** Run `verify` (it MUST throw when the effect is absent or wrong) as a step and record the scope as verified. */
    assertOnChainEffect(testInfo: Pick<TestInfo, 'testId' | 'title'>, description: string, verify: () => Promise<void>): Promise<void>;
    isVerified(testInfo: Pick<TestInfo, 'testId'>): boolean;
}

/** Call once at the top level of the suite file (it registers a file-wide `afterEach`). */
export const useOnChainEffectGate = (test: AnyTest, options: OnChainEffectGateOptions = {}): OnChainEffectGate => {
    const verified = new Set<string>();
    const log = options.log ?? console.log;
    // Playwright requires the fixtures argument to be an object pattern.
    // eslint-disable-next-line no-empty-pattern
    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status !== 'passed' || options.exempt?.(testInfo)) return;
        if (!verified.has(testInfo.testId)) {
            throw new Error(
                `${STRICTNESS_VIOLATION}: "${testInfo.title}" passed without proving an on-chain effect (assertOnChainEffect). No scope may pass on UI state alone — see STRICTNESS.md.`
            );
        }
    });
    return {
        assertOnChainEffect: async (testInfo, description, verify) => {
            await test.step(`on-chain effect: ${description}`, verify);
            verified.add(testInfo.testId);
            log(`[on-chain verified] ${testInfo.title} — ${description}`);
        },
        isVerified: (testInfo) => verified.has(testInfo.testId)
    };
};

/** A RegExp without the stateful `g`/`y` flags, so `.test` answers the same on every call. */
const stateless = (pattern: RegExp) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));

export interface BannedPattern {
    name: string;
    pattern: RegExp;
}

/** Escape hatches no live suite may contain as code. */
export const DEFAULT_BANNED_PATTERNS: BannedPattern[] = [
    { name: 'test.only (silently narrows the run)', pattern: /test\s*\.\s*only\s*\(/ },
    { name: 'test.skip', pattern: /test\s*\.\s*skip\s*\(/ },
    { name: 'test.fixme', pattern: /test\s*\.\s*fixme\s*\(/ },
    { name: 'E2E_SKIP_* bypass flag', pattern: /E2E_SKIP_/ }
];

/** A `.catch(() => false|undefined|null)` that turns a missing requirement into a branch. Opt-in: some suites still probe optional UI this way. */
export const SOFT_FAIL_CATCH: BannedPattern = { name: 'soft-fail catch that swallows a requirement', pattern: /\.catch\(\s*\(\)\s*=>\s*(false|undefined|null)\s*\)/ };

/** The suite source without comment and doc-box lines, so prose that NAMES a banned token does not match. */
export const stripCommentLines = (source: string) =>
    source
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*|│|┌|└|├)/.test(line))
        .join('\n');

export interface ScopeBody {
    title: string;
    body: string;
}

/** Split the suite into scope bodies: each runs from its `test('<title>'` to the next scope (or the end of the file). */
export const scopeBodies = (source: string, scopeTitle: RegExp): ScopeBody[] => {
    const pattern = new RegExp(scopeTitle.source, scopeTitle.flags.includes('g') ? scopeTitle.flags : `${scopeTitle.flags}g`);
    const hits = [...source.matchAll(pattern)].map((m) => ({ title: m[1] ?? m[0], index: m.index as number }));
    return hits.map((hit, i) => ({ title: hit.title, body: source.slice(hit.index, hits[i + 1]?.index ?? source.length) }));
};

export interface LiveSuiteStrictnessOptions {
    /** Absolute path of the live suite. */
    specFile: string;
    /** Matches a scope declaration; capture group 1 is its title. E.g. /test\(\s*'(scope H\d+:[^']*)'/ */
    scopeTitle: RegExp;
    /** Fewer scopes than this means the parser or the suite broke. */
    minScopes: number;
    /** What counts as proving an effect inside a scope body. Add the suite's helpers that call assertOnChainEffect. */
    proof?: RegExp;
    /** Added to DEFAULT_BANNED_PATTERNS. */
    banned?: BannedPattern[];
    /** Prefix for the generated test titles. */
    title?: string;
}

/**
 * Registers the strictness meta-tests for one suite. Add suite-specific structural checks next to it
 * with `readSuiteSource`.
 */
export const defineLiveSuiteStrictness = (test: AnyTest, options: LiveSuiteStrictnessOptions) => {
    const { raw, code } = readSuiteSource(options.specFile);
    const prefix = options.title ?? 'live suite';
    const proof = stateless(options.proof ?? /assertOnChainEffect\(/);
    const fail = (message: string) => {
        throw new Error(`${STRICTNESS_VIOLATION}: ${message} — fix the product, not the test (STRICTNESS.md).`);
    };

    for (const banned of [...DEFAULT_BANNED_PATTERNS, ...(options.banned ?? [])]) {
        test(`${prefix} has no escape hatch: ${banned.name}`, () => {
            if (stateless(banned.pattern).test(code)) fail(`"${banned.name}" is present as code in ${options.specFile}`);
        });
    }

    test(`${prefix}: the on-chain-effect gate is wired and the suite is serial`, () => {
        if (!/useOnChainEffectGate\(\s*test\b/.test(code)) fail('the suite does not call useOnChainEffectGate(test, ...)');
        if (!/test\.describe\.serial\(|test\.describe\.configure\(\s*\{\s*mode:\s*['"]serial['"]/.test(code)) fail('the suite is not serial (scopes must run in order and stop at the first failure)');
    });

    test(`${prefix}: every scope proves an on-chain effect`, () => {
        const scopes = scopeBodies(raw, options.scopeTitle);
        if (scopes.length < options.minScopes) fail(`found ${scopes.length} scopes, expected at least ${options.minScopes} (the scope parser or the suite broke)`);
        const missing = scopes.filter((scope) => !proof.test(scope.body)).map((scope) => scope.title);
        if (missing.length) fail(`these scopes can pass on UI state alone (no ${proof}): ${missing.join(', ')}`);
    });
};

export const readSuiteSource = (specFile: string) => {
    const raw = readFileSync(specFile, 'utf8');
    return { raw, code: stripCommentLines(raw) };
};
