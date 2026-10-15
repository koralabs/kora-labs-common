import { fetchProviderJson } from './fetchProviderJson';
import { RateLimitedError, recordRateLimit, rateLimitWaitRemainingMs, resetRateLimits, waitForRateLimit } from './rateLimit';

// Fake clock at the clock/timer boundary only. Real timers run on the monotonic clock while a recorded
// block is wall-clock ms (Date.now()), so a timer can fire before Date.now() reaches the stated time.
// This clock reproduces that: every timer of more than 1 ms fires 1 ms early relative to Date.now().
let now = 0;
const sleeps: number[] = [];
let onSleep: (() => void) | undefined;

beforeEach(() => {
    now = 1_790_000_000_000;
    sleeps.length = 0;
    onSleep = undefined;
    resetRateLimits();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms = 0) => {
        sleeps.push(ms);
        now += ms > 1 ? ms - 1 : ms;
        onSleep?.();
        fn();
        return 0;
    }) as unknown as typeof setTimeout);
});

afterEach(() => {
    jest.restoreAllMocks();
    resetRateLimits();
});

const jsonResponse = (status: number, bodyText: string, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => bodyText,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }
});

describe('waitForRateLimit', () => {
    it('does not return before Date.now() reaches the recorded time, even when the timer fires early', async () => {
        recordRateLimit('early-timer', 1000);
        const blockedUntil = now + 1000;
        await waitForRateLimit('early-timer', 5_000);
        expect(Date.now()).toBeGreaterThanOrEqual(blockedUntil);
        expect(rateLimitWaitRemainingMs('early-timer')).toBe(0);
        // The first timer came back 1 ms short; the rest was sat out, not skipped.
        expect(sleeps).toEqual([1000, 1]);
    });

    it('returns at once when nothing is recorded for the key', async () => {
        await waitForRateLimit('never-limited', 5_000);
        expect(sleeps).toEqual([]);
    });

    it('hands the wait back when another caller extends the block past maxWaitMs mid-wait', async () => {
        recordRateLimit('extended', 1000);
        onSleep = () => {
            onSleep = undefined;
            recordRateLimit('extended', 60_000);
        };
        const error = await waitForRateLimit('extended', 5_000).catch((e) => e);
        expect(error).toBeInstanceOf(RateLimitedError);
        expect((error as RateLimitedError).retryAfterMs).toBe(60_000);
        expect(sleeps).toEqual([1000]);
    });
});

describe('fetchProviderJson with an early-firing timer', () => {
    it('never re-calls the provider before a stated Retry-After has passed by Date.now()', async () => {
        const callTimes: number[] = [];
        const remainingAtCall: number[] = [];
        const fetcher = async () => {
            callTimes.push(Date.now());
            remainingAtCall.push(rateLimitWaitRemainingMs('bf-early'));
            return callTimes.length === 1
                ? jsonResponse(429, '{"error":"Too Many Requests","status_code":429}', { 'retry-after': '1' })
                : jsonResponse(200, '{"ok":true}');
        };
        const result = await fetchProviderJson<{ ok: boolean }>({ provider: 'Blockfrost', url: 'https://x', maxRps: 1000, rateLimitKey: 'bf-early', fetcher });
        expect(result).toEqual({ ok: true });
        expect(callTimes).toHaveLength(2);
        expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
        // The re-call happens only once the recorded block has expired by Date.now().
        expect(remainingAtCall).toEqual([0, 0]);
    });
});

// Invariant: the longest provider wait binds all callers, even if shorter hints appear first.
// Negative control: the original first-body-hint implementation re-calls after one second.
describe('shared live harness provider waits', () => {
    it('honors all body RetryInfo hints and the header maximum before a retry', async () => {
        const times: number[] = [];
        const fetcher = async () => {
            times.push(Date.now());
            return times.length === 1
                ? jsonResponse(429, JSON.stringify({ retry_after: 1, error: { details: [
                    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' },
                    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '4s' }
                ] } }), { 'retry-after': '3' })
                : jsonResponse(200, '{"ok":true}');
        };
        expect(await fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'all-hints', maxRps: 1000, fetcher })).toEqual({ ok: true });
        expect(times).toHaveLength(2);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(4000);
    });

    // Invariant: a final rejection preserves a reset-only 429 wait for another caller.
    // Negative control: original ignores reset epoch without Remaining: 0 and calls again.
    it('persists a reset-only 429 across callers without an early retry', async () => {
        let calls = 0;
        const at = now;
        const fetcher = async () => {
            calls++;
            return jsonResponse(429, '{"error":"limited","status_code":429}', { 'x-ratelimit-reset': String((at + 120_000) / 1000) });
        };
        const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'reset-only', maxRps: 1000, maxRateLimitWaitMs: 5000, fetcher });
        await expect(request()).rejects.toBeInstanceOf(RateLimitedError);
        await expect(request()).rejects.toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(1);
        expect(now + rateLimitWaitRemainingMs('reset-only')).toBe(at + 120_000);
    });

    // Invariant: provider waits survive malformed JSON, before a parse failure can trigger retries.
    // Negative control: original parses first and loses all rate-limit evidence from malformed bodies.
    it('preserves response header waits even when the body is malformed', async () => {
        let calls = 0;
        let receivedAt = 0;
        const fetcher = async () => { calls++; receivedAt = now; return jsonResponse(503, 'not json', { 'retry-after': '120' }); };
        const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'bad-json-wait', maxRps: 1000, maxRetries: 0, maxRateLimitWaitMs: 5000, fetcher });
        await expect(request()).rejects.toThrow('503');
        expect(now + rateLimitWaitRemainingMs('bad-json-wait')).toBe(receivedAt + 120_000);
        await expect(request()).rejects.toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(1);
    });

    // Invariant: delta waits start when headers arrive, and available success resets are not exhaustion.
    // Negative control: original anchors the exhausted-success wait after the body delay.
    it('anchors an exhausted success wait at receipt instead of after a slow body', async () => {
        let receivedAt = 0;
        const fetcher = async () => { receivedAt = now; return ({ ...jsonResponse(200, '{"ok":true}', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '10' }), text: async () => { now += 2000; return '{"ok":true}'; } }); };
        expect(await fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'slow-body', maxRps: 1000, fetcher })).toEqual({ ok: true });
        expect(now - receivedAt).toBeGreaterThanOrEqual(2000);
        expect(now + rateLimitWaitRemainingMs('slow-body')).toBe(receivedAt + 10_000);
    });

    // Invariant: admission before another response arrives never authorizes a call inside its wait.
    // Negative control: original checks only before enqueue and dispatches the admitted second request.
    it('rechecks a queued caller against the wait recorded by the preceding response', async () => {
        let calls = 0;
        let release: (response: ReturnType<typeof jsonResponse>) => void = () => undefined;
        const firstResponse = new Promise<ReturnType<typeof jsonResponse>>((resolve) => { release = resolve; });
        const fetcher = async () => { calls++; return calls === 1 ? firstResponse : jsonResponse(200, '{"wrongEarlyCall":true}'); };
        const request = () => fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'admitted-wait', maxRps: 1000, maxRateLimitWaitMs: 5000, maxRetries: 0, fetcher });
        const first = request();
        while (!calls) await Promise.resolve();
        const second = request().catch((error) => error);
        await Promise.resolve();
        release(jsonResponse(200, '{"ok":true}', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '120' }));
        expect(await first).toEqual({ ok: true });
        expect(await second).toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(1);
    });

    it('does not invent exhaustion from available successful reset headers', async () => {
        const fetcher = async () => jsonResponse(200, '{"ok":true}', { 'x-ratelimit-remaining': '5', 'x-ratelimit-reset-after': '120' });
        expect(await fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: 'available', maxRps: 1000, fetcher })).toEqual({ ok: true });
        expect(rateLimitWaitRemainingMs('available')).toBe(0);
    });
});
