import { fetchProviderJson } from './fetchProviderJson';
import { resetRateLimits } from './rateLimit';

// Same-key callers must wait for the entire response's rate signals before dispatch.
// The HTTP response body and clock are boundaries; the real transport/queue execute.
it('does not dispatch a same-key caller while a prior body-only wait is unknown', async () => {
    jest.useFakeTimers({ now: 1000000 });
    resetRateLimits();
    let releaseBody!: (body: string) => void;
    const body = new Promise<string>(resolve => { releaseBody = resolve; });
    const calls: string[] = [];
    const fetcher = async (url: string) => {
        calls.push(url);
        if (calls.length === 1) {
            const response = new Response('', { status: 429 });
            response.text = () => body;
            return response;
        }
        return new Response('{"ok":true}', { status: 200 });
    };
    const options = { provider: 'Blockfrost' as const, rateLimitKey: 'own-delayed-body',
        maxRetries: 0, maxRateLimitWaitMs: 0, maxRps: 100, fetcher };
    try {
        const first = fetchProviderJson({ ...options, url: 'https://offline/first' });
        const firstSettled = Promise.allSettled([first]);
        await jest.advanceTimersByTimeAsync(100);
        expect(calls).toEqual(['https://offline/first']);
        const second = fetchProviderJson({ ...options, url: 'https://offline/second' });
        const secondSettled = Promise.allSettled([second]);
        await jest.advanceTimersByTimeAsync(100);
        const beforeBodySignals = [...calls];
        releaseBody('{"error":"Too many requests","status_code":429,"retry_after":600}');
        await jest.advanceTimersByTimeAsync(100);
        const results = [...await firstSettled, ...await secondSettled];
        expect(beforeBodySignals).toEqual(['https://offline/first']);
        expect(calls).toEqual(['https://offline/first']);
        expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    } finally {
        releaseBody('{"retry_after":600}');
        resetRateLimits();
        jest.useRealTimers();
    }
});
