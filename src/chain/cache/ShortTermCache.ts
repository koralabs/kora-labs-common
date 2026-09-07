type Entry<T> = { value: T; expiresAt: number };

/**
 * Process-local short-TTL cache with in-flight de-duplication. Concurrent identical requests share
 * a single upstream fetch, and a successful result is served from memory for `ttlMs`. Failures are
 * NEVER cached (the fetcher promise only writes to the store on resolve). The clock is injectable so
 * TTL behavior is unit-testable. Ported from the handle.me BFF into kora-labs-common.
 */
export class ShortTermCache {
    private store = new Map<string, Entry<unknown>>();
    private inflight = new Map<string, Promise<unknown>>();

    constructor(private readonly now: () => number = Date.now) {}

    async get<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
        const hit = this.store.get(key);
        if (hit && hit.expiresAt > this.now()) {
            return hit.value as T;
        }

        const pending = this.inflight.get(key);
        if (pending) {
            return pending as Promise<T>;
        }

        const promise = (async () => {
            const value = await fetcher();
            this.store.set(key, { value, expiresAt: this.now() + ttlMs });
            return value;
        })().finally(() => {
            this.inflight.delete(key);
        });

        this.inflight.set(key, promise);
        return promise as Promise<T>;
    }

    delete(key: string): void {
        this.store.delete(key);
        this.inflight.delete(key);
    }

    clear(): void {
        this.store.clear();
        this.inflight.clear();
    }
}

/** Shared process-local cache instance for repetitive chain reads. */
export const sharedShortTermCache = new ShortTermCache();
