import { fetchProviderJson, isRetriableError } from './fetchProviderJson';

const jsonResponse = (status: number, bodyText: string, ok = status >= 200 && status < 300) => ({
    ok,
    status,
    statusText: '',
    text: async () => bodyText
});

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

    it('retries a retriable 429 then succeeds', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return calls === 1 ? jsonResponse(429, '{"error":"Too Many Requests","status_code":429}') : jsonResponse(200, '{"ok":true}');
        };
        const result = await fetchProviderJson<{ ok: boolean }>({
            provider: 'Blockfrost',
            url: 'https://x',
            maxRps: 1000,
            retryBaseDelayMs: 1,
            fetcher
        });
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
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
    });
});
