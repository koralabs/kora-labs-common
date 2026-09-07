import { ShortTermCache } from './ShortTermCache';

describe('ShortTermCache', () => {
    it('serves a successful result from cache within TTL (one upstream call)', async () => {
        let now = 1000;
        const cache = new ShortTermCache(() => now);
        let calls = 0;
        const fetcher = async () => {
            calls++;
            return 'v';
        };
        expect(await cache.get('k', 5000, fetcher)).toBe('v');
        expect(await cache.get('k', 5000, fetcher)).toBe('v');
        expect(calls).toBe(1);
    });

    it('re-fetches after the TTL expires', async () => {
        let now = 1000;
        const cache = new ShortTermCache(() => now);
        let calls = 0;
        const fetcher = async () => ++calls;
        await cache.get('k', 5000, fetcher);
        now = 6001;
        await cache.get('k', 5000, fetcher);
        expect(calls).toBe(2);
    });

    it('de-duplicates concurrent identical requests into one fetch', async () => {
        const cache = new ShortTermCache();
        let calls = 0;
        let resolve!: (v: string) => void;
        const fetcher = () => {
            calls++;
            return new Promise<string>((r) => {
                resolve = r;
            });
        };
        const a = cache.get('k', 5000, fetcher);
        const b = cache.get('k', 5000, fetcher);
        resolve('v');
        expect(await a).toBe('v');
        expect(await b).toBe('v');
        expect(calls).toBe(1);
    });

    it('never caches a failure', async () => {
        const cache = new ShortTermCache();
        let calls = 0;
        const fetcher = async () => {
            calls++;
            if (calls === 1) throw new Error('boom');
            return 'ok';
        };
        await expect(cache.get('k', 5000, fetcher)).rejects.toThrow('boom');
        // A retry must reach the fetcher again (the failure was not stored).
        expect(await cache.get('k', 5000, fetcher)).toBe('ok');
        expect(calls).toBe(2);
    });
});
