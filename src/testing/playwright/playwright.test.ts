import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resetRateLimits } from '../../chain/transport/rateLimit';
import { loadEnvFiles, loadLiveEnv, readEnvFile } from './env';
import { createEvidence } from './evidence';
import { assertPreflight, runPreflightChecks, walletFundedCheck } from './preflight';
import { defineLiveSuiteStrictness, scopeBodies, SOFT_FAIL_CATCH, stripCommentLines, useOnChainEffectGate } from './strictness';
import { trimStaticSegments } from './video';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'klc-pw-'));
const quiet = () => undefined;

describe('env', () => {
    const dir = tmp();
    const local = path.join(dir, '.env.local');
    const shared = path.join(dir, '.env.shared');
    writeFileSync(local, '# comment\nE2E_LIVE_WALLET_MNEMONIC="local words"\nE2E_HAL_ACCOUNT_INDEX=1\nNOEQUALS\n');
    writeFileSync(shared, "E2E_LIVE_WALLET_MNEMONIC=shared words\nE2E_LIVE_BLOCKFROST_API_KEY='bf-key'\nE2E_LIVE_NETWORK=PREPROD\n");

    it('readEnvFile parses quotes and comments; a missing file is empty', () => {
        expect(readEnvFile(local)).toEqual({ E2E_LIVE_WALLET_MNEMONIC: 'local words', E2E_HAL_ACCOUNT_INDEX: '1' });
        expect(readEnvFile(path.join(dir, 'missing'))).toEqual({});
    });

    it('loadLiveEnv: the environment wins, then the files in order', () => {
        const env = loadLiveEnv({ files: [local, shared], env: { E2E_LIVE_BLOCKFROST_API_KEY: 'from-env' }, accountIndexKey: 'E2E_HAL_ACCOUNT_INDEX' });
        expect(env.mnemonic).toBe('local words');
        expect(env.blockfrostApiKey).toBe('from-env');
        expect(env.network).toBe('preprod');
        expect(env.accountIndex).toBe(1);
        expect(env.chain).toEqual({ network: 'preprod', blockfrostApiKey: 'from-env' });
    });

    it('loadLiveEnv fails loud on missing configuration and bad values', () => {
        expect(() => loadLiveEnv({ env: {} })).toThrow('E2E_LIVE_BLOCKFROST_API_KEY is not configured');
        expect(() => loadLiveEnv({ files: [shared], env: {}, network: 'devnet' })).toThrow('unknown network "devnet"');
        expect(() => loadLiveEnv({ files: [shared], env: { E2E_LIVE_ACCOUNT_INDEX: '-1' } })).toThrow('must be a non-negative integer');
    });

    it('loadEnvFiles fills only unset variables', () => {
        const env: Record<string, string | undefined> = { E2E_LIVE_WALLET_MNEMONIC: 'kept' };
        loadEnvFiles([local, shared], env);
        expect(env.E2E_LIVE_WALLET_MNEMONIC).toBe('kept');
        expect(env.E2E_HAL_ACCOUNT_INDEX).toBe('1');
        expect(env.E2E_LIVE_BLOCKFROST_API_KEY).toBe('bf-key');
    });
});

// A stand-in for Playwright's `test` that records registrations.
const fakeTest = () => {
    const beforeHooks: ((fixtures: object, testInfo: unknown) => Promise<void>)[] = [];
    const hooks: ((fixtures: object, testInfo: unknown) => Promise<void>)[] = [];
    const tests: { title: string; fn: () => void }[] = [];
    const test = Object.assign((title: string, fn: () => void) => tests.push({ title, fn }), {
        beforeEach: (fn: (typeof beforeHooks)[number]) => beforeHooks.push(fn),
        afterEach: (fn: (typeof hooks)[number]) => hooks.push(fn),
        step: async (_title: string, fn: () => Promise<void>) => fn()
    });
    return { test: test as never, hooks, beforeHooks, tests };
};

describe('useOnChainEffectGate', () => {
    const info = (status: string, testId = 't1') => ({ status, testId, title: `scope ${testId}` });

    it('fails a passed scope that never proved an effect, and passes one that did', async () => {
        const { test, hooks } = fakeTest();
        const gate = useOnChainEffectGate(test, { log: quiet });
        expect(hooks).toHaveLength(1);
        await expect(hooks[0]({}, info('passed'))).rejects.toThrow('STRICTNESS VIOLATION: "scope t1" passed without proving an on-chain effect');
        await gate.assertOnChainEffect(info('passed'), 'minted', async () => undefined);
        await expect(hooks[0]({}, info('passed'))).resolves.toBeUndefined();
        expect(gate.isVerified({ testId: 't1' })).toBe(true);
    });

    it('records nothing when the verification throws, ignores failed scopes, honours exemptions', async () => {
        const { test, hooks } = fakeTest();
        const gate = useOnChainEffectGate(test, { log: quiet, exempt: (t) => t.testId === 'resumed' });
        await expect(gate.assertOnChainEffect(info('passed'), 'minted', async () => Promise.reject(new Error('no token')))).rejects.toThrow('no token');
        expect(gate.isVerified({ testId: 't1' })).toBe(false);
        await expect(hooks[0]({}, info('failed'))).resolves.toBeUndefined();
        await expect(hooks[0]({}, info('passed', 'resumed'))).resolves.toBeUndefined();
    });

    // Invariant: each execution proves its own effect; a previous execution cannot green-light it.
    // Failure caught: a proof survives a repeat/retry sharing the test ID. Original source fails this.
    it('requires a fresh proof when another attempt uses the same test ID', async () => {
        const { test, hooks, beforeHooks } = fakeTest();
        const gate = useOnChainEffectGate(test, { log: quiet });
        await gate.assertOnChainEffect(info('passed'), 'first attempt effect', async () => undefined);
        await hooks[0]({}, info('passed'));
        for (const hook of beforeHooks) await hook({}, info('passed'));
        expect(gate.isVerified({ testId: 't1' })).toBe(false);
        await expect(hooks[0]({}, info('passed'))).rejects.toThrow('passed without proving an on-chain effect');
        await gate.assertOnChainEffect(info('passed'), 'fresh effect', async () => undefined);
        await expect(hooks[0]({}, info('passed'))).resolves.toBeUndefined();
    });

    // Invariant: the latest required verification must succeed, even when a caller catches its error.
    // Failure caught: a successful earlier verification conceals a later absent effect. Original fails.
    it('invalidates the earlier proof when a later verification fails', async () => {
        const { test, hooks } = fakeTest();
        const gate = useOnChainEffectGate(test, { log: quiet });
        await gate.assertOnChainEffect(info('passed'), 'first effect', async () => undefined);
        await expect(gate.assertOnChainEffect(info('passed'), 'required later effect', async () => {
            throw new Error('required token absent');
        })).rejects.toThrow('required token absent');
        expect(gate.isVerified({ testId: 't1' })).toBe(false);
        await expect(hooks[0]({}, info('passed'))).rejects.toThrow('passed without proving an on-chain effect');
    });

    it('the registered hook uses an object pattern for fixtures (Playwright rejects anything else)', () => {
        const { test, hooks } = fakeTest();
        useOnChainEffectGate(test, { log: quiet });
        expect(hooks[0].toString()).toMatch(/^async\s*\(\{\s*\},\s*testInfo\)/);
    });
});

describe('defineLiveSuiteStrictness', () => {
    const GOOD = `
import { test } from '@playwright/test';
// test.only( is named in prose here and must not count
const gate = useOnChainEffectGate(test, {});
test.describe.configure({ mode: 'serial' });
test('scope 01: mint', async () => { await assertOnChainEffect(testInfo, 'x', fn); });
test('scope 02: burn', async () => { await proveBurn(); });
`;
    const run = (source: string, extra: Partial<Parameters<typeof defineLiveSuiteStrictness>[1]> = {}) => {
        const file = path.join(tmp(), 'live-cip30.spec.ts');
        writeFileSync(file, source);
        const { test, tests } = fakeTest();
        defineLiveSuiteStrictness(test, { specFile: file, scopeTitle: /test\(\s*'(scope \d+:[^']*)'/, minScopes: 2, proof: /assertOnChainEffect\(|proveBurn\(/g, ...extra });
        return tests.flatMap((t) => {
            try {
                t.fn();
                return [];
            } catch (error) {
                return [`${t.title} => ${(error as Error).message}`];
            }
        });
    };

    it('passes a compliant suite (comments are ignored, a global proof regex is safe)', () => {
        expect(run(GOOD)).toEqual([]);
    });

    it('fails on an escape hatch, a missing gate, a non-serial suite, an unproven scope, or too few scopes', () => {
        expect(run(GOOD.replace("test('scope 02", "test.skip('scope 02")).join()).toMatch(/no escape hatch: test\.skip/);
        expect(run(GOOD.replace('useOnChainEffectGate(test', 'noGate(test')).join()).toMatch(/does not call useOnChainEffectGate/);
        expect(run(GOOD.replace("test.describe.configure({ mode: 'serial' });", '')).join()).toMatch(/is not serial/);
        expect(run(GOOD.replace('await proveBurn();', 'await page.click(x);')).join()).toMatch(/UI state alone.*scope 02: burn/);
        expect(run(GOOD, { minScopes: 3 }).join()).toMatch(/found 2 scopes, expected at least 3/);
        expect(run(GOOD.replace('proveBurn();', 'proveBurn().catch(() => false);'), { banned: [SOFT_FAIL_CATCH] }).join()).toMatch(/soft-fail catch/);
    });

    // Invariant: commented-out verification cannot satisfy the source preflight.
    // Failure caught: deleting a proof but leaving its name in a comment yields a green meta-test.
    it('rejects a scope whose only proof is a comment', () => {
        const unproven = GOOD.replace('await proveBurn();', '\n// await proveBurn();\nawait page.click(x);');
        expect(run(unproven).join()).toMatch(/UI state alone.*scope 02: burn/);
    });

    it('scopeBodies splits at each scope and stripCommentLines drops prose lines', () => {
        expect(scopeBodies(GOOD, /test\('(scope \d+:[^']*)'/).map((s) => s.title)).toEqual(['scope 01: mint', 'scope 02: burn']);
        expect(stripCommentLines(' * test.only(\n// x\ncode')).toBe('code');
    });
});

describe('preflight', () => {
    beforeEach(() => resetRateLimits());

    it('runs every check, reports each, and throws listing the failures', async () => {
        const result = await runPreflightChecks([
            { name: 'a', run: async () => 'fine' },
            { name: 'b', run: async () => Promise.reject(new Error('broken')) }
        ]);
        expect(result).toEqual({ ok: false, checks: [{ name: 'a', ok: true, detail: 'fine' }, { name: 'b', ok: false, detail: 'broken' }] });
        const lines: string[] = [];
        expect(() => assertPreflight(result, (l) => lines.push(l))).toThrow(/NO bypass[\s\S]*b: broken/);
        expect(lines).toEqual(['preflight OK: a — fine', 'preflight FAIL: b — broken']);
        expect(() => assertPreflight({ ok: true, checks: [] }, quiet)).not.toThrow();
    });

    it('walletFundedCheck compares chain lovelace with the minimum and names the fund hint', async () => {
        const chain = { network: 'preview' as const, blockfrostApiKey: 'k', fetchFn: (async () => new Response(JSON.stringify({ amount: [{ unit: 'lovelace', quantity: '10' }] }))) as typeof fetch };
        await expect(walletFundedCheck(chain, 'addr_test1x', BigInt(10)).run()).resolves.toBe('10 lovelace >= 10');
        await expect(walletFundedCheck(chain, 'addr_test1x', BigInt(11), 'Fund it.').run()).rejects.toThrow('addr_test1x has 10 lovelace; needs 11. Fund it.');
    });
});

// A stand-in for a Playwright page with a recorded video.
const fakePage = (visible: boolean, videoFile: string) => {
    const events: string[] = [];
    let closed = false;
    const page = {
        locator: () => ({ first: () => ({ waitFor: async () => (visible ? undefined : Promise.reject(new Error('timeout'))) }) }),
        screenshot: async ({ path: p }: { path: string }) => {
            events.push(`screenshot ${path.basename(p)}`);
            writeFileSync(p, 'png');
        },
        video: () => ({ saveAs: async (p: string) => (events.push(`video ${path.basename(p)}`), writeFileSync(p, readFileSync(videoFile))) }),
        isClosed: () => closed,
        close: async () => {
            closed = true;
            events.push('close');
        },
        bringToFront: async () => events.push('front'),
        unrouteAll: async () => events.push('unroute')
    };
    return { page: page as never, events };
};

describe('createEvidence', () => {
    const video = path.join(tmp(), 'raw.webm');
    writeFileSync(video, 'webm');

    it('screenshots only after the success state, then saves the video from afterEach', async () => {
        const dir = tmp();
        const reached: string[] = [];
        const evidence = createEvidence({ dir, log: quiet, reachSuccess: async (_p, selector) => void reached.push(selector) });
        const { page, events } = fakePage(true, video);
        const testInfo = { annotations: [] as { type: string; description?: string }[] };
        await evidence.saveEvidence(page, testInfo as never, 'scope-01', '#ok');
        await evidence.saveVideo(page, testInfo as never);
        expect(reached).toEqual(['#ok']);
        expect(events).toEqual(['screenshot scope-01-success.png', 'close', 'video scope-01.webm']);
        expect(existsSync(path.join(dir, 'scope-01.webm'))).toBe(true);
    });

    it('leaves a failure screenshot (never a success one) and still keeps the video', async () => {
        const dir = tmp();
        const evidence = createEvidence({ dir, log: quiet });
        const { page, events } = fakePage(false, video);
        const testInfo = { annotations: [] as { type: string; description?: string }[] };
        await expect(evidence.saveEvidence(page, testInfo as never, 'scope-02', '#ok', 5)).rejects.toThrow('scope-02: success state "#ok" not reached');
        await evidence.saveVideo(page, testInfo as never);
        expect(events).toEqual(['screenshot scope-02-failure.png', 'close', 'video scope-02.webm']);
    });

    // Invariant: a scope cannot claim complete evidence when recording was disabled.
    // Failure caught: a success screenshot silently substitutes for the required screenshot + video.
    it('fails evidence finalization when the page has no recording', async () => {
        const dir = tmp();
        const evidence = createEvidence({ dir, log: quiet });
        const testInfo = { annotations: [] as { type: string; description?: string }[] };
        let closed = false;
        const page = {
            locator: () => ({ first: () => ({ waitFor: async () => undefined }) }),
            screenshot: async ({ path: target }: { path: string }) => writeFileSync(target, 'png'),
            video: () => null,
            isClosed: () => closed,
            close: async () => { closed = true; }
        };
        await evidence.saveEvidence(page as never, testInfo as never, 'scope-no-video', '#ok');
        await expect(evidence.saveVideo(page as never, testInfo as never)).rejects.toThrow('scope-no-video: video recording is unavailable');
        expect(closed).toBe(true);
        expect(readFileSync(path.join(dir, 'scope-no-video-success.png'), 'utf8')).toBe('png');
        expect(existsSync(path.join(dir, 'scope-no-video.webm'))).toBe(false);
    });

    it('saveVideo does nothing for a scope without evidence; tab evidence closes its own tab', async () => {
        const dir = tmp();
        const evidence = createEvidence({ dir, log: quiet, trimVideo: true });
        const idle = fakePage(true, video);
        await evidence.saveVideo(idle.page, { annotations: [] } as never);
        expect(idle.events).toEqual([]);
        const tab = fakePage(true, video);
        const finish = await evidence.saveTabEvidence(tab.page, 'scope-03-order2', '#ok');
        await finish();
        expect(tab.events).toEqual(['front', 'screenshot scope-03-order2-success.png', 'unroute', 'close', 'video scope-03-order2.raw.webm']);
        // the trim of a non-video falls back to the raw recording; the raw file is removed
        expect(readFileSync(path.join(dir, 'scope-03-order2.webm'), 'utf8')).toBe('webm');
        expect(existsSync(path.join(dir, 'scope-03-order2.raw.webm'))).toBe(false);
    });
});

describe('trimStaticSegments', () => {
    it('keeps a raw copy when the input cannot be trimmed', () => {
        const dir = tmp();
        const input = path.join(dir, 'in.webm');
        writeFileSync(input, 'not a video');
        expect(trimStaticSegments(input, path.join(dir, 'out.webm'))).toBe(false);
        expect(readFileSync(path.join(dir, 'out.webm'), 'utf8')).toBe('not a video');
    });
});
