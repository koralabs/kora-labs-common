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

const parseSeconds = (raw: unknown): number | null => {
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    if (String(raw).trim() === '') return null;
    const value = Number(String(raw).trim().replace(/s$/i, ''));
    return Number.isFinite(value) && value >= 0 ? value : null;
};

/** `Retry-After` is either delta-seconds or an HTTP date. */
const parseRetryAfter = (raw: string | null | undefined, now: number): number | null => {
    const seconds = parseSeconds(raw);
    if (seconds !== null) return toMs(seconds);
    if (!raw || Number.isFinite(Number(raw))) return null;
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

const retryInfoSeconds = (duration: unknown): number | null => {
    if (typeof duration === 'string') return parseSeconds(duration);
    if (!duration || typeof duration !== 'object' || Array.isArray(duration)) return null;
    const { seconds = 0, nanos = 0 } = duration as { seconds?: unknown; nanos?: unknown };
    const s = parseSeconds(seconds);
    const n = parseSeconds(nanos);
    return s !== null && n !== null && n < 1_000_000_000 ? s + n / 1_000_000_000 : null;
};

const bodyWaitMs = (body: unknown): number | null => {
    const waits: number[] = [];
    for (const entry of Array.isArray(body) ? body : [body]) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, any>;
        const retryAfter = parseSeconds(record.retry_after);
        if (retryAfter !== null) waits.push(toMs(retryAfter));
        const details = record.error?.details;
        for (const detail of Array.isArray(details) ? details : []) {
            if (typeof detail?.['@type'] !== 'string' || !detail['@type'].endsWith('google.rpc.RetryInfo')) continue;
            const delay = retryInfoSeconds(detail.retryDelay);
            if (delay !== null) waits.push(toMs(delay));
        }
    }
    return waits.length ? Math.max(...waits) : null;
};

/**
 * The wait (ms) a response asks for, or null when it states none. Covers Retry-After (seconds or
 * date), X-RateLimit-Reset-After, RateLimit-Reset, X-RateLimit-Remaining: 0 + X-RateLimit-Reset,
 * and waits written in the body (Discord `retry_after`, Google `RetryInfo.retryDelay`).
 */
export const statedWaitMs = (headers: HeaderReader | undefined, body: unknown, now = Date.now(), status?: number): number | null => {
    const header = (name: string) => headers?.get(name) ?? null;
    const exhausted = status === 429 || header('x-ratelimit-remaining')?.trim() === '0' || header('ratelimit-remaining')?.trim() === '0';
    const resetApplies = status === undefined || status < 200 || status >= 300 || exhausted;
    const candidates = [
        parseRetryAfter(header('retry-after'), now),
        !resetApplies || parseSeconds(header('x-ratelimit-reset-after')) === null ? null : toMs(parseSeconds(header('x-ratelimit-reset-after'))!),
        !resetApplies || parseSeconds(header('ratelimit-reset-after')) === null ? null : toMs(parseSeconds(header('ratelimit-reset-after'))!),
        !resetApplies || parseSeconds(header('ratelimit-reset')) === null ? null : toMs(parseSeconds(header('ratelimit-reset'))!),
        exhausted ? parseReset(header('x-ratelimit-reset'), now) : null,
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

/**
 * Wait out a recorded limit before calling `key`; throw (returning the wait) when it exceeds `maxWaitMs`.
 * A timer runs on the monotonic clock while the block is wall-clock ms (Date.now()), so it can fire a
 * millisecond or more before Date.now() reaches the stated time: re-check and keep waiting until it has.
 */
export const waitForRateLimit = async (key: string, maxWaitMs: number): Promise<void> => {
    for (let remaining = rateLimitWaitRemainingMs(key); remaining > 0; remaining = rateLimitWaitRemainingMs(key)) {
        if (remaining > maxWaitMs) throw new RateLimitedError(key, remaining);
        await sleep(remaining);
    }
};

/** Test seam: forget every recorded limit. */
export const resetRateLimits = () => blockedUntilByKey.clear();
