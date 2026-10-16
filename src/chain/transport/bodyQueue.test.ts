import { fetchProviderJson } from './fetchProviderJson';
import { RateLimitedError, rateLimitWaitRemainingMs, resetRateLimits } from './rateLimit';

beforeEach(() => { jest.useFakeTimers({ now: 1000000 }); resetRateLimits(); });
afterEach(() => { resetRateLimits(); jest.useRealTimers(); });
const deferred = () => {
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const response = (status: number, text: () => Promise<string>, headers: Record<string, string> = {}) => ({
    status, ok: status >= 200 && status < 300, statusText: '', text,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }
});

// A pending body remains a same-key admission barrier. Header/body durations use their own receipt times.
// Negative control: anchoring body waits at headers expires the first two holds3100ms early.
it.each([
    ['no header429/body wait', 429, {}, '{"error":"limited","status_code":429,"retry_after":600}', 600000, true],
    ['short header/long body', 429, { 'retry-after': '1' }, '{"error":"limited","status_code":429,"retry_after":600}', 600000, true],
    ['malformed body/header hold', 503, { 'retry-after': '600' }, 'not JSON', 600000, false]
])('%s protects three queued callers and preserves unrelated-key progress', async (_name, status, headers, text, wait, bodyAnchor) => {
    const body = deferred(); const calls: string[] = []; const at = Date.now();
    const fetcher = async (url: string) => { calls.push(url); return url.endsWith('/first')
        ? response(status as number, () => body.promise, headers as Record<string, string>)
        : response(200, async () => '{"ok":true}'); };
    const request = (path: string, key = 'body-three') => fetchProviderJson({ provider: 'Blockfrost', url: `https://offline/${path}`,
        rateLimitKey: key, maxRetries: 0, maxRps: 100, maxRateLimitWaitMs: 0, fetcher });
    const first = Promise.allSettled([request('first')]);
    await jest.advanceTimersByTimeAsync(1100);
    const rest = Promise.allSettled([request('second'), request('third')]);
    const unrelated = request('other', 'different-key');
    await jest.advanceTimersByTimeAsync(2000); // The short header expires; a longer body remains unknown.
    const before = [...calls];
    const other = await unrelated;
    const bodyAt = Date.now();
    body.resolve(text as string);
    await jest.advanceTimersByTimeAsync(100);
    const results = [...await first, ...await rest];
    expect(before).toEqual(['https://offline/first', 'https://offline/other']);
    expect(calls).toEqual(before);
    expect(other).toEqual({ ok: true });
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results.slice(1).every(r => r.status === 'rejected' && r.reason instanceof RateLimitedError)).toBe(true);
    expect(Date.now() + rateLimitWaitRemainingMs('body-three')).toBe((bodyAnchor ? bodyAt : at) + (wait as number));
});

// No stated wait does not create a fabricated hold, but still requires body completion.
it('headerless429 without a wait refuses the first response then releases a queued read', async () => {
    const body = deferred(); const calls: number[] = [];
    const fetcher = async () => { calls.push(Date.now()); return calls.length === 1
        ? response(429, () => body.promise) : response(200, async () => '{"ok":true}'); };
    const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'no-wait-body', maxRetries: 0, maxRps: 100, fetcher });
    const first = Promise.allSettled([request()]); await jest.advanceTimersByTimeAsync(100);
    const second = request(); await jest.advanceTimersByTimeAsync(100);
    const before = calls.length; body.resolve('{"error":"limited","status_code":429}');
    await jest.advanceTimersByTimeAsync(100);
    expect(before).toBe(1); expect((await first)[0].status).toBe('rejected');
    expect(await second).toEqual({ ok: true }); expect(calls).toHaveLength(2);
});

it.each([['with header wait', { 'retry-after': '600' }, true], ['without header wait', {}, false]])(
    'body retrieval failure %s releases the barrier and retains every observed header signal', async (_name, headers, held) => {
        const body = deferred(); let calls = 0;
        const fetcher = async () => ++calls === 1 ? response(503, () => body.promise, headers as Record<string, string>) : response(200, async () => '{"ok":true}');
        const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'body-failure', maxRetries: 0, maxRps: 100, maxRateLimitWaitMs: 0, fetcher });
        const first = Promise.allSettled([request()]); await jest.advanceTimersByTimeAsync(100);
        const second = Promise.allSettled([request()]); await jest.advanceTimersByTimeAsync(100);
        const before = calls; body.reject(new Error('body unavailable')); await jest.advanceTimersByTimeAsync(100);
        expect(before).toBe(1); expect((await first)[0]).toMatchObject({ status: 'rejected', reason: { message: 'body unavailable' } });
        expect((await second)[0].status).toBe(held ? 'rejected' : 'fulfilled');
        expect(calls).toBe(held ? 1 : 2);
        expect(rateLimitWaitRemainingMs('body-failure') > 0).toBe(held);
    }
);

// Exercise a batch already waiting behind first, with the second response's body blocked.
it('serializes body signals within a pending batch rather than only the first task', async () => {
    const firstBody = deferred(); const secondBody = deferred(); const calls: number[] = [];
    const fetcher = async () => { calls.push(Date.now()); return calls.length === 1 ? response(200, () => firstBody.promise)
        : calls.length === 2 ? response(429, () => secondBody.promise) : response(200, async () => '{"early":true}'); };
    const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'batch', maxRps: 100, maxRetries: 0, maxRateLimitWaitMs: 0, fetcher });
    const first = request(); await jest.advanceTimersByTimeAsync(100);
    const rest = Promise.allSettled([request(), request()]); firstBody.resolve('{"ok":true}');
    await jest.advanceTimersByTimeAsync(100); const before = calls.length;
    secondBody.resolve('{"error":"limited","status_code":429,"retry_after":600}'); await jest.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ ok: true }); expect(before).toBe(2); expect(calls).toHaveLength(2);
    expect((await rest).map(r => r.status)).toEqual(['rejected', 'rejected']);
});
it('retains minimum maxRps dispatch spacing across successful same-key callers', async () => {
    const times: number[] = [];
    const fetcher = async () => { times.push(Date.now()); return response(200, async () => '{"ok":true}'); };
    const results = Promise.all(Array.from({ length: 3 }, () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'spacing', maxRps: 5, fetcher })));
    await jest.advanceTimersByTimeAsync(1000); expect(await results).toHaveLength(3);
    expect(times).toHaveLength(3); expect(times[1] - times[0]).toBeGreaterThanOrEqual(200); expect(times[2] - times[1]).toBeGreaterThanOrEqual(200);
});
