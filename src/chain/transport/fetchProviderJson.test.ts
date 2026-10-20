import { createServer } from 'node:http';
import { fetchProviderJson, fetchRateLimitedResponse, isRetriableError } from './fetchProviderJson';
import { RateLimitedError, rateLimitWaitRemainingMs, recordRateLimit, resetRateLimits, statedWaitMs } from './rateLimit';

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

    // Invariant: every valid protocol duration contributes, while unrelated business JSON cannot impose waits.
    // Negative control: the string-only parser throws on the duration object; recursive parsing blocks business data.
    it('maxes structured RetryInfo with other hints without traversing business data', () => {
        expect(statedWaitMs(undefined, { retry_after: 1, error: { details: [
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: { seconds: '2', nanos: 500000000 } },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }
        ] } }, now)).toBe(2500);
        expect(statedWaitMs(undefined, { retry_after: {}, error: { details: [
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: {} },
            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }
        ] } }, now)).toBe(3000);
        expect(statedWaitMs(undefined, { model: { tool_args: { retry_after: 3600 } }, history: [
            { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }] } }
        ] }, now, 200)).toBeNull();
    });

    // Invariant: error reset hints apply beyond429, but an available success window is not exhaustion.
    // Negative control: the429-only applicability and missing alias each fail an exact duration below.
    it('honors error reset hints and their alias without inventing successful exhaustion', () => {
        expect(statedWaitMs(headers({ 'x-ratelimit-reset-after': '5' }), undefined, now, 503)).toBe(5000);
        expect(statedWaitMs(headers({ 'ratelimit-reset-after': '7' }), undefined, now, 429)).toBe(7000);
        expect(statedWaitMs(headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-reset-after': '120' }), undefined, now, 200)).toBeNull();
    });
});

describe('response lifecycle regressions', () => {
    afterEach(() => { jest.restoreAllMocks(); resetRateLimits(); });

    // Invariant: relative body waits start at body receipt, independently of header receipt.
    // Negative control: the released single receivedAt anchor gives6000ms remaining instead of8000ms.
    it.each([[5, 8000], [20, 18000]])('anchors a late body without rebasing a %ss header', async (headerSeconds, remaining) => {
        let now = 1_790_000_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const key = `body-receipt-${headerSeconds}`;
        const fetcher = async () => ({ ...jsonResponse(200, '', true, { 'retry-after': String(headerSeconds) }),
            text: async () => { now += 2000; return '{"retry_after":8,"ok":true}'; }
        });
        expect(await fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: key, maxRps: 1000, fetcher })).toEqual({ retry_after: 8, ok: true });
        expect(rateLimitWaitRemainingMs(key)).toBe(remaining);
    });

    // Invariant: a later hold invalidates admission even in the final promise-continuation gap.
    // Negative control: released inner await gate still dispatches once inside the known hour hold.
    it('rechecks synchronously immediately before queued dispatch', async () => {
        const key = 'final-admission-gap';
        let calls = 0;
        const pending = fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', rateLimitKey: key,
            maxRps: 1000, maxRateLimitWaitMs: 0, fetcher: async () => { calls++; return jsonResponse(200, '[]'); }
        }).catch(error => error);
        await Promise.resolve(); // The outer gate resumes and the actual queued gate awaits.
        recordRateLimit(key, 3_600_000);
        expect(await pending).toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(0);
        expect(rateLimitWaitRemainingMs(key)).toBeGreaterThan(3_500_000);
    });

    // Invariant: native redirect responses cannot hide waits or issue unadmitted follow-up HTTP.
    // Negative control: default native follow returns200, emits two wire requests and loses the floor.
    it.each([['GET', 302], ['POST', 302], ['GET', 307], ['POST', 307], ['GET', 429], ['POST', 429]])(
        'observes native %s %s without following and preserves the maximum', async (method, status) => {
            const wire: { method: string | undefined; path: string | undefined }[] = [];
            const server = createServer((req, res) => {
                wire.push({ method: req.method, path: req.url }); req.resume();
                if (req.url === '/limited') res.writeHead(status as number, { Location: '/final', 'Retry-After': '3600', 'Content-Type': 'application/json' }).end('{"retry_after":7200}');
                else res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"wrongFollow":true}');
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
            const key = `native-${method}-${status}`;
            try {
                const result = await fetchProviderJson({ provider: 'Blockfrost', url: `http://127.0.0.1:${address.port}/limited`,
                    method: String(method), body: method === 'POST' ? '{}' : undefined, maxRps: 1000, maxRetries: 0, maxRateLimitWaitMs: 0, rateLimitKey: key
                }).catch(error => error);
                expect(result).toBeInstanceOf(RateLimitedError);
                expect(wire).toEqual([{ method, path: '/limited' }]);
                expect(rateLimitWaitRemainingMs(key)).toBeGreaterThan(7_100_000);
            } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
        }
    );
});

describe('shared raw Response transport', () => {
    afterEach(() => { jest.restoreAllMocks(); resetRateLimits(); });

    // Invariant: raw callers retain the exact response/body while every applicable wait protects later callers.
    // Negative control: restoring HAL's status/header-only observation loses body-only and success floors.
    it.each([
        [429, {}, { retry_after: 3600 }], [503, {}, { retry_after: 3600 }],
        [200, { 'Retry-After': '3600' }, { ok: true }],
        [200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '3600' }, { ok: true }]
    ])('preserves a raw %s while recording its protocol hold', async (status, headers, payload) => {
        const key = `raw-${status}-${JSON.stringify(headers)}`;
        const response = new Response(JSON.stringify(payload), { status: status as number, headers: headers as HeadersInit });
        let calls = 0;
        const request = () => fetchRateLimitedResponse({ rateLimitKey: key, maxRateLimitWaitMs: 0,
            dispatch: async options => { expect(options).toEqual({ redirect: 'manual', signal: expect.any(AbortSignal) }); calls++; return response; },
            readText: res => res.clone().text()
        });
        const observed = await request();
        expect(observed.response).toBe(response);
        expect(response.bodyUsed).toBe(false);
        expect(await response.json()).toEqual(payload);
        expect(observed.statedWait).toBe(true);
        await expect(request()).rejects.toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(1);
    });

    // Invariant: observation is not retry policy and unavailable JSON does not fabricate a successful payload.
    // Negative control: requiring JSON or retrying non-ok responses changes identity, body or dispatch count.
    it.each([200, 404, 429, 504])('returns unhinted non-JSON %s unchanged without a retry', async status => {
        const response = new Response('original text', { status });
        let calls = 0;
        const observed = await fetchRateLimitedResponse({ rateLimitKey: `raw-text-${status}`,
            dispatch: async () => { calls++; return response; }, readText: res => res.clone().text()
        });
        expect(observed.response).toBe(response);
        expect(observed.statedWait).toBe(false);
        expect(observed.body.ok && observed.body.parseError).toBeInstanceOf(SyntaxError);
        expect(response.bodyUsed).toBe(false);
        expect(await response.text()).toBe('original text');
        expect(calls).toBe(1);
    });

    // Invariant: header evidence precedes a slow/failed body, without converting body faults to native dispatch faults.
    // Negative control: moving observation after body reading loses the hold; catch-all error enrichment changes cause/identity.
    it('retains headers and the original response/read error when clone reading fails', async () => {
        const key = 'raw-failed-body';
        const failure = new Error('body stream failed');
        let rejectBody!: (error: Error) => void;
        let entered!: () => void;
        const reading = new Promise<void>(resolve => { entered = resolve; });
        const stream = new ReadableStream({ start: controller => { rejectBody = error => controller.error(error); } });
        const response = new Response(stream, { headers: { 'Retry-After': '3600' } });
        const nativeContext = jest.fn((error: unknown): never => { throw Object.assign(new Error('native dispatch failed'), { cause: error }); });
        const pending = fetchRateLimitedResponse({ rateLimitKey: key, dispatch: async () => response,
            onDispatchError: nativeContext, readText: res => { entered(); return res.clone().text(); }
        });
        await reading;
        expect(rateLimitWaitRemainingMs(key)).toBeGreaterThan(3_500_000);
        rejectBody(failure);
        const result = await pending;
        expect(result.response).toBe(response);
        expect(result.body).toEqual({ ok: false, error: failure });
        expect(nativeContext).not.toHaveBeenCalled();
        expect(response.bodyUsed).toBe(false);
        await expect(response.text()).rejects.toEqual(failure);
    });

    // Invariant: native context is added only to dispatch errors, not admission failure or body observation.
    // Negative control: wrapping the whole shared request changes RateLimitedError into the diagnostic Error.
    it('supports native cause enrichment without reclassifying a held admission', async () => {
        const native = new TypeError('native failure');
        const wrapped = Object.assign(new Error('safe transport context'), { cause: native });
        const context = jest.fn((_error: unknown): never => { throw wrapped; });
        const key = 'raw-context';
        await expect(fetchRateLimitedResponse({ rateLimitKey: key, dispatch: () => Promise.reject(native), onDispatchError: context,
            readText: (res: Response) => res.clone().text()
        })).rejects.toBe(wrapped);
        expect(context.mock.calls).toEqual([[native]]);
        recordRateLimit(key, 3_600_000);
        let calls = 0;
        await expect(fetchRateLimitedResponse({ rateLimitKey: key, maxRateLimitWaitMs: 0,
            dispatch: async () => { calls++; return new Response('{}'); }, onDispatchError: context, readText: res => res.clone().text()
        })).rejects.toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(0);
        expect(context.mock.calls).toEqual([[native]]);
    });

    // Invariant: unpaced admission also rejects a hold announced in the final await gap.
    // Negative control: deleting the synchronous recheck starts one raw HTTP inside the hour hold.
    it('rechecks an unpaced admission immediately before dispatch', async () => {
        const key = 'raw-admission-gap';
        let calls = 0;
        const pending = fetchRateLimitedResponse({ rateLimitKey: key, maxRateLimitWaitMs: 0,
            dispatch: async () => { calls++; return new Response('{}'); }, readText: res => res.clone().text()
        }).catch(error => error);
        recordRateLimit(key, 3_600_000);
        expect(await pending).toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(0);
    });

    // Invariant: unpaced callers retain concurrency; response receipt still binds a later microtask caller.
    // Negative control: silently queueing raw calls prevents the second start; delaying observation admits a third request.
    it('keeps raw reads concurrent but registers headers before promise adoption', async () => {
        const key = 'raw-receipt';
        const responses: ((response: Response) => void)[] = [];
        let calls = 0;
        const request = () => fetchRateLimitedResponse({ rateLimitKey: key, maxRateLimitWaitMs: 0,
            dispatch: () => { calls++; return new Promise<Response>(resolve => { responses.push(resolve); }); }, readText: res => res.clone().text()
        });
        const first = request(); const second = request();
        await Promise.resolve();
        expect(calls).toBe(2);
        responses[0](new Response('{}', { headers: { 'Retry-After': '3600' } }));
        await Promise.resolve();
        await expect(request()).rejects.toBeInstanceOf(RateLimitedError);
        expect(calls).toBe(2);
        responses[1](new Response('{}'));
        expect((await first).statedWait).toBe(true);
        expect((await second).statedWait).toBe(false);
    });
});
