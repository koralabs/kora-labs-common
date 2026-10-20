import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchRateLimitedResponse, RequestTimeoutError } from './fetchProviderJson';
import { resetRateLimits } from './rateLimit';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFetch = require('node-fetch') as typeof fetch;

const PAYLOAD = JSON.stringify({ items: Array.from({ length: 12000 }, (_, index) => ({ index, handle: `handle-${index}` })) }); // ~300KB
let server: Server;
let url: string;

beforeAll(async () => {
    server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(PAYLOAD) });
        // Many chunks, so the body cannot fit inside any tee buffer.
        for (let offset = 0; offset < PAYLOAD.length; offset += 8192) response.write(PAYLOAD.slice(offset, offset + 8192));
        response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page`;
});
afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => resetRateLimits());

// Invariant: a large successful body is read once by the transport and still fully readable by the caller,
// with node-fetch AND native fetch, with or without a caller-supplied clone reader.
// Failure caught: the transport read only a CLONE of an unread node-fetch response; the ~16KB tee buffer then
// stalled the request until the deadline (the Minting silent >300s hang on 190KB api.handle.me pages).
// Negative control: the previous clone-reading transport rejects these node-fetch cases with RequestTimeoutError.
describe.each([
    ['node-fetch', (target: string, init: { redirect: 'manual'; signal: AbortSignal }) => nodeFetch(target, init)],
    ['native fetch', (target: string, init: { redirect: 'manual'; signal: AbortSignal }) => fetch(target, init)]
])('%s', (_name, doFetch) => {
    it.each([
        ['no readText', undefined],
        ['legacy clone readText', (response: Response) => response.clone().text()]
    ])('returns the full body and a readable response (%s)', async (_label, readText) => {
        const started = Date.now();
        const observed = await fetchRateLimitedResponse<Response>({
            rateLimitKey: `large-${_name}-${_label}`, requestTimeoutMs: 5000,
            dispatch: options => doFetch(url, options) as Promise<Response>,
            ...(readText ? { readText } : {})
        });
        expect(Date.now() - started).toBeLessThan(2500);
        expect(observed.body).toMatchObject({ ok: true, parseError: null });
        expect((observed.body as { text: string }).text).toBe(PAYLOAD);
        // The caller can still consume the response exactly as it would a normal fetch result.
        expect(observed.response.status).toBe(200);
        expect(observed.response.headers.get('content-type')).toBe('application/json');
        const parsed = await observed.response.json() as { items: unknown[] };
        expect(parsed.items).toHaveLength(12000);
    });
});

it('still enforces the deadline on a stalled node-fetch body', async () => {
    const stalled = createServer((_request, response) => { response.writeHead(200, { 'content-length': '1000' }); response.write('{"partial":'); });
    await new Promise<void>(resolve => stalled.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}/`;
    try {
        const observed = await fetchRateLimitedResponse<Response>({
            rateLimitKey: 'nf-stall', requestTimeoutMs: 150,
            dispatch: options => nodeFetch(target, options) as Promise<Response>
        });
        expect(observed.body.ok).toBe(false);
        expect((observed.body as { error: unknown }).error).toBeInstanceOf(RequestTimeoutError);
    } finally {
        stalled.closeAllConnections();
        await new Promise<void>(resolve => stalled.close(() => resolve()));
    }
});
