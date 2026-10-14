import { assertAssetBurned } from './onChain';
import { resetRateLimits } from '../chain/transport/rateLimit';

// A successful HTTP envelope without a measured nonnegative integer quantity
// must never grant burn proof. Only the external provider boundary is replaced.
it.each([
    ['missing', {}],
    ['null quantity', { quantity: null }],
    ['empty string', { quantity: '' }],
    ['whitespace', { quantity: ' ' }],
    ['boolean', { quantity: false }],
    ['null successful JSON', null]
])('refuses unknown asset quantity: %s', async (_name, body) => {
    resetRateLimits();
    const chain = { network: 'preview' as const, blockfrostApiKey: 'offline-only',
        fetchFn: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch };
    await expect(assertAssetBurned(chain, 'a'.repeat(56) + '00')).rejects.toThrow();
});
