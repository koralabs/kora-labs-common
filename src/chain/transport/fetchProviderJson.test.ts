import { fetchProviderJson, isRetriableError } from './fetchProviderJson';
import { RateLimitedError, rateLimitWaitRemainingMs, resetRateLimits, statedWaitMs } from './rateLimit';

const jsonResponse = (status: number, bodyText: string, ok = status >= 200 && status < 300, headers: Record<string, string> = {}) => ({
    ok,
    status,
    statusText: '',
    text: async () => bodyText,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }
});

afterAll(() => resetRateLimits());

describe('fetchProviderJson', () => {
    it('returns parsed JSON on success', async () => {
        const fetcher = async () => jsonResponse(200, JSON.stringify([{ a: 1 }]));
        const result = await fetchProviderJson<{ a: number }[]>({
            provider: 'Koios',
            url: 'https://x',
            maxRps: 1000,
            fetcher
        });
        expect(result).toEqual([{ a: 1 }]);
    });

    it('waits out a 429 Retry-After before calling again, then succeeds', async () => {
        const callTimes: number[] = [];
        const fetcher = async () => {
            callTimes.push(Date.now());
            return callTimes.length === 1
                ? jsonResponse(429, '{"error":"Too Many Requests","status_code":429}', false, { 'retry-after': '1' })
                : jsonResponse(200, '{"ok":true}');
        };
        const result = await fetchProviderJson<{ ok: boolean }>({
            provider: 'Blockfrost',
            url: 'https://x',
            maxRps: 1000,
            rateLimitKey: 'retry-after-test',
            fetcher
        });
        expect(result).toEqual({ ok: true });
        expect(callTimes).toHaveLength(2);
        // Invariant: the second call is not made before the stated second has passed.
        expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
    });

    it('sits out a stated wait even for a call that allows no error retries (e.g. tx submission)', async () => {
        const bodies: unknown[] = [];
        const callTimes: number[] = [];
        const fetcher = async (_url: string, init?: { body?: string | Uint8Array }) => {
            bodies.push(init?.body);
            callTimes.push(Date.now());
            return callTimes.length === 1
                ? jsonResponse(429, '{"error":"Too Many Requests","status_code":429}', false, { 'retry-after': '1' })
                : jsonResponse(200, '"txhash"');
        };
        const cbor = Uint8Array.from([0x84, 0xa0]);
        const result = await fetchProviderJson<string>({ provider: 'Blockfrost', url: 'https://x', method: 'POST', body: cbor, maxRetries: 0, maxRps: 1000, rateLimitKey: 'post-test', fetcher });
        expect(result).toBe('txhash');
        expect(bodies).toEqual([cbor, cbor]);
        expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
    });

    it('does not blindly retry a 429 that states no wait', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return jsonResponse(429, '{"error":"Too Many Requests","status_code":429}');
        };
        await expect(
            fetchProviderJson({ provider: 'Blockfrost', url: 'https://x', maxRps: 1000, maxRetries: 3, rateLimitKey: 'no-wait-test', fetcher })
        ).rejects.toThrow(/429/);
        expect(calls).toBe(1);
    });

    it('returns the wait instead of holding the caller when the stated wait is too long', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return jsonResponse(429, '{"error":"Too Many Requests","status_code":429}', false, { 'retry-after': '120' });
        };
        const key = 'long-wait-test';
        const error = await fetchProviderJson({ provider: 'Blockfrost', url: 'https://x', maxRps: 1000, rateLimitKey: key, maxRateLimitWaitMs: 5_000, fetcher }).catch((e) => e);
        expect(error).toBeInstanceOf(RateLimitedError);
        expect((error as RateLimitedError).retryAfterMs).toBeGreaterThan(119_000);
        expect(calls).toBe(1);

        // The wait is remembered process-wide: the next caller on the key does not reach the server.
        const second = await fetchProviderJson({ provider: 'Blockfrost', url: 'https://y', maxRps: 1000, rateLimitKey: key, maxRateLimitWaitMs: 5_000, fetcher }).catch((e) => e);
        expect(second).toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(1);
        expect(rateLimitWaitRemainingMs(key)).toBeGreaterThan(100_000);
    });

    it('records an exhausted quota from a successful response for the next call', async () => {
        const key = 'quota-test';
        const fetcher = async () => jsonResponse(200, '{"ok":true}', true, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '90' });
        await fetchProviderJson({ provider: 'Blockfrost', url: 'https://x', maxRps: 1000, rateLimitKey: key, fetcher });
        expect(rateLimitWaitRemainingMs(key)).toBeGreaterThan(80_000);
    });

    it('throws a provider error for a Koios payload error (code+message)', async () => {
        const fetcher = async () => jsonResponse(200, '{"code":"42P01","message":"relation does not exist"}');
        await expect(
            fetchProviderJson({ provider: 'Koios', url: 'https://x', maxRps: 1000, maxRetries: 0, fetcher })
        ).rejects.toThrow(/Koios request failed/);
    });

    it('does not retry a non-retriable 404 (fails fast)', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return jsonResponse(404, '{"error":"Not Found","status_code":404}');
        };
        await expect(
            fetchProviderJson({ provider: 'Blockfrost', url: 'https://x', maxRps: 1000, maxRetries: 3, fetcher })
        ).rejects.toThrow();
        expect(calls).toBe(1);
    });

    it('isRetriableError classifies transient socket errors', () => {
        expect(isRetriableError('Koios', { code: 'ECONNRESET' })).toBe(true);
        expect(isRetriableError('Blockfrost', { status: 503 })).toBe(true);
        expect(isRetriableError('Blockfrost', { status: 400 })).toBe(false);
        expect(isRetriableError('Blockfrost', { status: 429 })).toBe(false);
    });
});

describe('statedWaitMs', () => {
    const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
    const now = Date.parse('2026-09-24T00:00:00Z');

    it('reads Retry-After as seconds or an HTTP date', () => {
        expect(statedWaitMs(headers({ 'retry-after': '3' }), undefined, now)).toBe(3000);
        expect(statedWaitMs(headers({ 'retry-after': 'Thu, 24 Sep 2026 00:00:10 GMT' }), undefined, now)).toBe(10_000);
    });

    it('reads reset headers and exhausted-quota epochs', () => {
        expect(statedWaitMs(headers({ 'x-ratelimit-reset-after': '2.5' }), undefined, now)).toBe(2500);
        expect(statedWaitMs(headers({ 'ratelimit-reset': '7' }), undefined, now)).toBe(7000);
        expect(statedWaitMs(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 20) }), undefined, now)).toBe(20_000);
        // A reset time with quota left is not a wait.
        expect(statedWaitMs(headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': String(now / 1000 + 20) }), undefined, now)).toBeNull();
    });

    it('reads waits written in the body (Discord retry_after, Google RetryInfo)', () => {
        expect(statedWaitMs(undefined, { retry_after: 1.25 }, now)).toBe(1250);
        expect(statedWaitMs(undefined, { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '4s' }] } }, now)).toBe(4000);
    });

    it('is null when nothing states a wait', () => {
        expect(statedWaitMs(headers({}), { error: 'Too Many Requests' }, now)).toBeNull();
    });
});
