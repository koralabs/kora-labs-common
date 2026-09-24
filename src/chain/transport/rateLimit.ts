// Rate-limit signals are law: every provider call honors the wait a server states, remembers it for
// the whole process (so other callers don't hit the same limit), and never retries early. When the
// stated wait is too long to hold the caller, it stops and hands the wait back (RateLimitedError).

export interface HeaderReader {
    get(name: string): string | null | undefined;
}

export class RateLimitedError extends Error {
    constructor(public readonly key: string, public readonly retryAfterMs: number, detail = '') {
        super(`Rate limited by ${key}: retry after ${Math.ceil(retryAfterMs / 1000)}s${detail ? ` (${detail})` : ''}`);
        this.name = 'RateLimitedError';
    }
}

const blockedUntilByKey = new Map<string, number>();

const toMs = (seconds: number) => Math.max(0, Math.ceil(seconds * 1000));

const parseSeconds = (raw: string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw.trim() === '') return null;
    const value = Number(raw.trim().replace(/s$/i, ''));
    return Number.isFinite(value) ? value : null;
};

/** `Retry-After` is either delta-seconds or an HTTP date. */
const parseRetryAfter = (raw: string | null | undefined, now: number): number | null => {
    const seconds = parseSeconds(raw);
    if (seconds !== null) return toMs(seconds);
    if (!raw) return null;
    const date = Date.parse(raw);
    return Number.isFinite(date) ? Math.max(0, date - now) : null;
};

/** `X-RateLimit-Reset` is an epoch (seconds or ms) on most APIs, a delta on a few; disambiguate by size. */
const parseReset = (raw: string | null | undefined, now: number): number | null => {
    const value = parseSeconds(raw);
    if (value === null) return null;
    if (value > 1e12) return Math.max(0, value - now); // epoch ms
    if (value > 1e9) return Math.max(0, value * 1000 - now); // epoch seconds
    return toMs(value); // delta seconds
};

const bodyWaitMs = (body: unknown): number | null => {
    if (!body || typeof body !== 'object') return null;
    const record = body as Record<string, any>;
    // Discord: { retry_after: seconds }
    const retryAfter = parseSeconds(record.retry_after === undefined ? undefined : String(record.retry_after));
    if (retryAfter !== null) return toMs(retryAfter);
    // Google: { error: { details: [{ '@type': '...RetryInfo', retryDelay: '1.5s' }] } }
    const details: any[] = record.error?.details ?? [];
    const retryInfo = details.find((d) => typeof d?.['@type'] === 'string' && d['@type'].endsWith('RetryInfo'));
    const delay = parseSeconds(retryInfo?.retryDelay);
    return delay === null ? null : toMs(delay);
};

/**
 * The wait (ms) a response asks for, or null when it states none. Covers Retry-After (seconds or
 * date), X-RateLimit-Reset-After, RateLimit-Reset, X-RateLimit-Remaining: 0 + X-RateLimit-Reset,
 * and waits written in the body (Discord `retry_after`, Google `RetryInfo.retryDelay`).
 */
export const statedWaitMs = (headers: HeaderReader | undefined, body: unknown, now = Date.now()): number | null => {
    const header = (name: string) => headers?.get(name) ?? null;
    const candidates = [
        parseRetryAfter(header('retry-after'), now),
        parseSeconds(header('x-ratelimit-reset-after')) === null ? null : toMs(parseSeconds(header('x-ratelimit-reset-after'))!),
        parseSeconds(header('ratelimit-reset')) === null ? null : toMs(parseSeconds(header('ratelimit-reset'))!),
        header('x-ratelimit-remaining')?.trim() === '0' ? parseReset(header('x-ratelimit-reset'), now) : null,
        bodyWaitMs(body)
    ].filter((ms): ms is number => ms !== null);
    return candidates.length > 0 ? Math.max(...candidates) : null;
};

/** Record that `key` must not be called for `waitMs` (only ever extends an existing block). */
export const recordRateLimit = (key: string, waitMs: number, now = Date.now()) => {
    const until = now + waitMs;
    if (until > (blockedUntilByKey.get(key) ?? 0)) blockedUntilByKey.set(key, until);
};

export const rateLimitWaitRemainingMs = (key: string, now = Date.now()) => Math.max(0, (blockedUntilByKey.get(key) ?? 0) - now);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait out a recorded limit before calling `key`; throw (returning the wait) when it exceeds `maxWaitMs`. */
export const waitForRateLimit = async (key: string, maxWaitMs: number): Promise<void> => {
    const remaining = rateLimitWaitRemainingMs(key);
    if (remaining === 0) return;
    if (remaining > maxWaitMs) throw new RateLimitedError(key, remaining);
    await sleep(remaining);
};

/** Test seam: forget every recorded limit. */
export const resetRateLimits = () => blockedUntilByKey.clear();
