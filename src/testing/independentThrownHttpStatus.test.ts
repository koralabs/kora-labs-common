import { assertAssetBurned } from './onChain';
import { resetRateLimits } from '../chain/transport/rateLimit';

// Unknown fetch exceptions must not supply burn proof without an observed HTTP response.
// Replacing the error with a real HTTP404 Response is the positive control in burnProof.test.ts.
it('refuses an unobserved fetch exception carrying httpStatus404', async () => {
    resetRateLimits();
    let calls = 0;
    const chain = {
        network: 'preview' as const,
        blockfrostApiKey: 'offline-only',
        fetchFn: (async () => {
            calls++;
            throw Object.assign(new Error('unobserved HTTP response'), { httpStatus: 404 });
        }) as typeof fetch
    };
    await expect(assertAssetBurned(chain, 'a'.repeat(56) + '00')).rejects.toThrow('unobserved HTTP response');
    expect(calls).toBe(1);
});
