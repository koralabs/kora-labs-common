import { fetchProviderJson, observedProviderHttpStatus, providerNotFoundError } from './fetchProviderJson';
import { resetRateLimits } from './rateLimit';

beforeEach(() => resetRateLimits());
// Public diagnostic fields do not establish or replace response provenance.
it('keeps actual HTTP status separate from payload status and mutable public diagnostics', async () => {
    let caught: unknown;
    try {
        await fetchProviderJson({ provider: 'Blockfrost', url: 'https://offline', maxRetries: 0,
            fetcher: async () => new Response(JSON.stringify({ error: 'Not Found', status_code: 404 }), { status: 200 }) });
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ status: 404, httpStatus: 200 });
    expect(observedProviderHttpStatus(caught)).toBe(200);
    Object.assign(caught as object, { httpStatus: 404 });
    expect(observedProviderHttpStatus(caught)).toBe(200);
});
it('does not attribute an observed response to a synthetic provider-not-found error', () => {
    const error = providerNotFoundError('Blockfrost', 'offline asset');
    expect(error).toMatchObject({ status: 404 });
    expect(observedProviderHttpStatus(error)).toBeUndefined();
});
it('does not infer provenance from raw shapes or primitives', () => {
    for (const error of [null, undefined, 404, '404', { status: 404, httpStatus: 404 }, Object.assign(new Error('unobserved'), { httpStatus: 404 })]) {
        expect(observedProviderHttpStatus(error)).toBeUndefined();
    }
});
