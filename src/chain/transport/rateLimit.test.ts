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
