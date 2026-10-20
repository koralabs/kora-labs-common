import { createServer, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchProviderJson, fetchRateLimitedResponse, RequestTimeoutError } from './fetchProviderJson';
import { resetRateLimits } from './rateLimit';

type Mode = 'headers-stall' | 'body-stall' | 'healthy';
let server: Server;
let base: string;
let mode: Mode;
const stalled: ServerResponse[] = [];
const closedStalledRequests: number[] = [];

beforeAll(async () => {
    server = createServer((request, response) => {
        const requestMode = (request.url === '/healthy' ? 'healthy' : mode) as Mode;
        if (requestMode === 'healthy') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"ok":true}'); return; }
        stalled.push(response);
        response.on('close', () => closedStalledRequests.push(stalled.length));
        if (requestMode === 'body-stall') { response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' }); response.write('{"partial":'); }
        // headers-stall: never respond
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    stalled.forEach(response => response.destroy());
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => { resetRateLimits(); stalled.length = 0; closedStalledRequests.length = 0; });

// Invariant: a stalled upstream is cut off at the per-call deadline with a clear error, never a silent hang.
// Failure caught: the shared transport waited for the runtime's 300s default, hanging a whole cron run.
// Negative control: removing the deadline makes these promises outlive the 1s test bound and the jest timeout.
describe.each<Mode>(['headers-stall', 'body-stall'])('a %s upstream', stallMode => {
    it('rejects with RequestTimeoutError, cancels the socket, and does not block the next same-key request', async () => {
        mode = stallMode;
        const started = Date.now();
        await expect(fetchProviderJson({ provider: 'Koios', url: `${base}/stall`, maxRetries: 0, requestTimeoutMs: 150, rateLimitKey: `stall-${stallMode}` }))
            .rejects.toBeInstanceOf(RequestTimeoutError);
        expect(Date.now() - started).toBeLessThan(1500);
        // The same key's queue is free: a healthy request on that key completes immediately.
        const healthy = await fetchProviderJson<{ ok: boolean }>({ provider: 'Koios', url: `${base}/healthy`, maxRetries: 0, requestTimeoutMs: 1000, rateLimitKey: `stall-${stallMode}` });
        expect(healthy).toEqual({ ok: true });
        // The default fetch received the signal, so the server saw the connection torn down.
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(closedStalledRequests.length).toBeGreaterThan(0);
    });
});

// Invariant: serialized same-key requests are released even when the dispatcher IGNORES the abort signal.
// Failure caught: a consumer's own fetch wrapper (raw Response callers) holding the queue forever.
// Negative control: relying on the signal alone leaves this never-resolving promise holding the queue.
it('releases the queue when the dispatcher never settles and ignores the signal', async () => {
    const hang = fetchRateLimitedResponse({
        rateLimitKey: 'ignores-signal', maxRps: 50, requestTimeoutMs: 100,
        dispatch: () => new Promise<never>(() => undefined),
        readText: async () => ''
    });
    await expect(hang).rejects.toBeInstanceOf(RequestTimeoutError);
    const next = await fetchRateLimitedResponse({
        rateLimitKey: 'ignores-signal', maxRps: 50, requestTimeoutMs: 1000,
        dispatch: async () => new Response('{"ok":true}', { status: 200 }),
        readText: response => response.clone().text()
    });
    expect(next.body).toMatchObject({ ok: true, text: '{"ok":true}' });
});

it('reports a stalled body read as the timeout, preserving the response for raw callers', async () => {
    const result = await fetchRateLimitedResponse({
        rateLimitKey: 'body-timeout', requestTimeoutMs: 100,
        dispatch: async () => new Response('x', { status: 200 }),
        readText: () => new Promise<string>(() => undefined)
    });
    expect(result.response.status).toBe(200);
    expect(result.body.ok).toBe(false);
    expect((result.body as { error: unknown }).error).toBeInstanceOf(RequestTimeoutError);
});

// Invariant: a timed-out write is not replayed (it may have been applied); a timed-out read is retried.
// Failure caught: tx-submit style POSTs duplicated after a timeout.
// Negative control: dropping the non-GET guard makes the POST case dispatch twice.
it('does not retry a timed-out POST but retries a timed-out GET', async () => {
    mode = 'headers-stall';
    let calls = 0;
    const counting = (_url: string) => { calls++; return new Promise<never>(() => undefined); };
    await expect(fetchProviderJson({ provider: 'Blockfrost', url: 'https://x.invalid', method: 'POST', body: '{}', maxRetries: 2,
        retryBaseDelayMs: 1, requestTimeoutMs: 50, rateLimitKey: 'post-timeout', fetcher: counting as never })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(calls).toBe(1);
    calls = 0;
    await expect(fetchProviderJson({ provider: 'Blockfrost', url: 'https://x.invalid', method: 'GET', maxRetries: 2,
        retryBaseDelayMs: 1, requestTimeoutMs: 50, rateLimitKey: 'get-timeout', fetcher: counting as never })).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(calls).toBe(3);
});
