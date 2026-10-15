import { assertAssetBurned } from './onChain';
import { blockfrostGet } from './blockfrost';
import { resetRateLimits } from '../chain/transport/rateLimit';

const unit = 'a'.repeat(56) + '00';
const fixture = (body: unknown, status = 200) => {
    const calls: { url: string; method: string }[] = [];
    const chain = {
        network: 'preview' as const, blockfrostApiKey: 'offline-only',
        fetchFn: (async (url: string | URL | Request, options?: RequestInit) => {
            calls.push({ url: String(url), method: options?.method ?? 'GET' });
            return new Response(JSON.stringify(body), { status });
        }) as typeof fetch
    };
    return { chain, calls };
};
beforeEach(() => resetRateLimits());

// Invariant: a measured canonical quantity0 is accepted through the real provider transport.
// Failure caught: rejecting all reads instead of validating unknown measurements breaks this happy path.
it('accepts the measured canonical string zero with exactly the requested asset read', async () => {
    const { chain, calls } = fixture({ quantity: '0' });
    await expect(assertAssetBurned(chain, unit)).resolves.toBeUndefined();
    expect(calls).toEqual([{ url: `https://cardano-preview.blockfrost.io/api/v0/assets/${unit}`, method: 'GET' }]);
});

// Invariant: coercible zero-like values and unsupported successful shapes never prove absence.
// Negative control: the old BigInt/fallback implementation accepts several of these as zero.
it.each([
    ['numeric zero', { quantity: 0 }], ['array quantity', { quantity: [] }],
    ['object quantity', { quantity: {} }], ['leading zeros', { quantity: '00' }],
    ['negative zero', { quantity: '-0' }], ['hex zero', { quantity: '0x0' }],
    ['signed zero', { quantity: '+0' }], ['decimal zero', { quantity: '0.0' }],
    ['trimmed zero', { quantity: '\t0\n' }], ['negative supply', { quantity: '-1' }],
    ['exponent string', { quantity: '1e0' }], ['successful array', []], ['successful boolean', false]
])('refuses noncanonical asset measurement: %s', async (_name, body) => {
    const { chain, calls } = fixture(body);
    await expect(assertAssetBurned(chain, unit, { timeoutMs: 5000, pollMs: 1 })).rejects.toThrow();
    expect(calls).toHaveLength(1); // Unknown measurements are refused, never polled into a guessed state.
});

// Invariant: only genuine HTTP404 owns the documented null sentinel.
// Negative control: the old producer returns null both for HTTP404 and successful JSONnull.
it('preserves genuine HTTP404 absence in the producer and burn assertion', async () => {
    const { chain, calls } = fixture({ error: 'Not Found', status_code: 404 }, 404);
    await expect(blockfrostGet(chain, `/assets/${unit}`)).resolves.toBeNull();
    await expect(assertAssetBurned(chain, unit)).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.method === 'GET' && call.url.endsWith(`/assets/${unit}`))).toBe(true);
});
it('refuses HTTP200 JSONnull at the producer before any consumer can mistake it for HTTP404', async () => {
    const { chain, calls } = fixture(null);
    await expect(blockfrostGet(chain, `/assets/${unit}`)).rejects.toThrow('absence requires HTTP 404');
    expect(calls).toHaveLength(1);
});
it('does not convert an HTTP200 payload claiming status404 into a genuine HTTP404 absence', async () => {
    const { chain, calls } = fixture({ error: 'Not Found', status_code: 404 });
    await expect(blockfrostGet(chain, `/assets/${unit}`)).rejects.toMatchObject({ status: 404, httpStatus: 200 });
    await expect(assertAssetBurned(chain, unit)).rejects.toMatchObject({ status: 404, httpStatus: 200 });
    expect(calls).toHaveLength(2);
});
it('does not treat an unknown fetch exception carrying only status404 as an HTTP measurement', async () => {
    let calls = 0;
    const chain = { network: 'preview' as const, blockfrostApiKey: 'offline-only', fetchFn: (async () => {
        calls++;
        throw Object.assign(new Error('unknown transport state'), { status: 404 });
    }) as typeof fetch };
    await expect(assertAssetBurned(chain, unit)).rejects.toThrow('unknown transport state');
    expect(calls).toBe(1);
});

// Invariant: known positive supply remains a failure or bounded poll, never immediate burn proof.
it('refuses a valid positive quantity without polling by default, without numeric precision loss', async () => {
    const quantity = '90071992547409931234567890';
    const { chain, calls } = fixture({ quantity });
    await expect(assertAssetBurned(chain, unit)).rejects.toThrow(`quantity is ${quantity}`);
    expect(calls).toHaveLength(1);
});
it('preserves positive-supply polling until a genuine measured zero', async () => {
    const seen: string[] = [];
    const values = ['2', '1', '0'];
    const chain = { network: 'preview' as const, blockfrostApiKey: 'offline-only', fetchFn: (async () => {
        const quantity = values[seen.length]; seen.push(quantity);
        return new Response(JSON.stringify({ quantity }), { status: 200 });
    }) as typeof fetch };
    await expect(assertAssetBurned(chain, unit, { timeoutMs: 5000, pollMs: 1 })).resolves.toBeUndefined();
    expect(seen).toEqual(['2', '1', '0']);
});
it('refuses an unknown measurement encountered after a valid positive poll', async () => {
    let calls = 0;
    const chain = { network: 'preview' as const, blockfrostApiKey: 'offline-only', fetchFn: (async () => {
        calls++;
        return new Response(JSON.stringify(calls === 1 ? { quantity: '1' } : {}), { status: 200 });
    }) as typeof fetch };
    await expect(assertAssetBurned(chain, unit, { timeoutMs: 5000, pollMs: 1 })).rejects.toThrow();
    expect(calls).toBe(2);
});
