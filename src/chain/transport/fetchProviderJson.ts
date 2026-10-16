import { HeaderReader, RateLimitedError, rateLimitWaitRemainingMs, recordRateLimit, statedWaitMs, waitForRateLimit } from './rateLimit';

// Shared provider transport: rate-limited, retrying JSON fetch with provider-aware payload-error
// detection. Ported from the handle.me BFF (the mature implementation) into kora-labs-common so
// every repo shares one hardened chain-access path. Uses the runtime's global `fetch` (Node 18+).

export type ProviderName = 'Koios' | 'Blockfrost';

type ProviderErrorPayload = {
    code?: string | number;
    error?: string;
    message?: string;
    status?: number;
    status_code?: number;
};

export interface RateLimitResponse {
    status: number;
    headers?: HeaderReader;
}

type ProviderFetcher = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; redirect?: 'manual' }
) => Promise<RateLimitResponse & { ok: boolean; statusText: string; text: () => Promise<string> }>;

type ObservedBody =
    | { ok: true; text: string; parsed: unknown; parseError: Error | null }
    | { ok: false; error: unknown };

export interface RateLimitedResponse<R> {
    response: R;
    body: ObservedBody;
    /** This response supplied a hint (including zero), independent of another caller's hold. */
    statedWait: boolean;
}

export interface RateLimitedResponseOptions<R extends RateLimitResponse> {
    rateLimitKey: string;
    maxRateLimitWaitMs?: number;
    /** Omit to retain an unpaced caller's existing concurrency. */
    maxRps?: number;
    /** The actual producer must honor manual redirects; it must not follow inside this callback. */
    dispatch: (options: { redirect: 'manual' }) => Promise<R>;
    /** Optional native-error context, without wrapping the fetch promise before header observation. */
    onDispatchError?: (error: unknown) => never;
    /** Consume text for JSON callers; read a clone to preserve a raw Response's body. */
    readText: (response: R) => Promise<string>;
}

interface ProviderRateLimitState {
    pending: QueuedProviderTask<any>[];
    processing: boolean;
    maxRps: number;
}

interface QueuedProviderTask<T> {
    task: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

export interface ProviderRequestOptions {
    provider: ProviderName;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    maxRps?: number;
    rateLimitKey?: string;
    /** Longest server-stated rate-limit wait to sit out in-process; longer waits throw RateLimitedError. */
    maxRateLimitWaitMs?: number;
    fetcher?: ProviderFetcher;
}

const DEFAULT_MAX_RPS = 5;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RATE_LIMIT_WAITS = 3;

// 429 is deliberately absent: a rate limit is retried only after the wait the server states (see
// fetchProviderJson), never on a blind backoff.
const RETRIABLE_STATUS_CODES = new Set([403, 408, 425, 500, 502, 503, 504]);
const RETRIABLE_MESSAGE_SNIPPETS = [
    'terminated',
    'socket',
    'econnreset',
    'fetch failed',
    'gateway timeout',
    'payload too large',
    'timed out acquiring connection from connection pool',
    'service unavailable',
    'temporarily unavailable'
];

const rateLimitStates = new Map<string, ProviderRateLimitState>();

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const getRateLimitState = (key: string): ProviderRateLimitState => {
    const existing = rateLimitStates.get(key);
    if (existing) return existing;
    const state: ProviderRateLimitState = { pending: [], processing: false, maxRps: DEFAULT_MAX_RPS };
    rateLimitStates.set(key, state);
    return state;
};

const processRateLimitedQueue = async (key: string): Promise<void> => {
    const state = getRateLimitState(key);
    if (state.processing) return;

    state.processing = true;
    try {
        while (state.pending.length > 0) {
            const pending = state.pending.splice(0, state.pending.length);
            const delayInMilliseconds = Math.ceil(1000 / Math.max(1, state.maxRps));

            // Same-key dispatch waits for the entire response's rate signals, not headers alone.
            for (const queuedTask of pending) {
                try {
                    const value = await queuedTask.task();
                    queuedTask.resolve(value);
                } catch (error) {
                    queuedTask.reject(error);
                }
                await delay(delayInMilliseconds);
            }
        }
    } finally {
        state.processing = false;
        if (state.pending.length > 0) {
            void processRateLimitedQueue(key);
        }
    }
};

const runRateLimitedTask = <T>(key: string, maxRps: number, task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const state = getRateLimitState(key);
        state.maxRps = maxRps;
        state.pending.push({ task, resolve, reject });
        void processRateLimitedQueue(key);
    });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string): { value: unknown; parseError: Error | null } => {
    if (!text) return { value: null, parseError: null };
    try {
        return { value: JSON.parse(text), parseError: null };
    } catch (error) {
        return { value: null, parseError: error as Error };
    }
};

const getProviderPayloadError = (provider: ProviderName, value: unknown): ProviderErrorPayload | null => {
    if (!isRecord(value)) return null;

    if (provider === 'Koios') {
        if (typeof value.code === 'string' && typeof value.message === 'string') {
            return value as ProviderErrorPayload;
        }
        return null;
    }

    if (typeof value.error === 'string' && (typeof value.status_code === 'number' || typeof value.message === 'string')) {
        return value as ProviderErrorPayload;
    }

    return null;
};

// Only errors constructed from an observed provider response carry this provenance.
const observedResponseStatuses = new WeakMap<object, number>();

/** Actual response status, independent of public error fields; undefined for unobserved errors. */
export const observedProviderHttpStatus = (error: unknown): number | undefined =>
    typeof error === 'object' && error !== null ? observedResponseStatuses.get(error) : undefined;

const createProviderError = ({
    provider,
    status,
    statusText,
    httpStatus,
    payload,
    responseText,
    cause
}: {
    provider: ProviderName;
    status: number;
    statusText: string;
    httpStatus?: number;
    payload?: unknown;
    responseText?: string;
    cause?: Error;
}): Error => {
    const error: any = new Error(`${provider} request failed: ${status} ${statusText}`.trim());
    if (cause) error.cause = cause;
    error.status = status;
    if (httpStatus !== undefined) {
        error.httpStatus = httpStatus;
        observedResponseStatuses.set(error, httpStatus);
    }
    error.statusText = statusText;
    if (payload !== undefined) {
        error[`${provider.toLowerCase()}Response`] = payload;
    }
    if (responseText) {
        error.responseText = responseText.slice(0, 512);
    }
    return error;
};

/** A provider's "that does not exist" answer, shaped like a transport 404 (`status: 404`). */
export const providerNotFoundError = (provider: ProviderName, what: string): Error =>
    createProviderError({ provider, status: 404, statusText: `${what} not found` });

const messageLooksRetriable = (value: string): boolean =>
    RETRIABLE_MESSAGE_SNIPPETS.some((snippet) => value.includes(snippet));

export const isRetriableError = (provider: ProviderName, error: any): boolean => {
    const status = Number(
        error?.status ??
            error?.statusCode ??
            error?.status_code ??
            error?.koiosResponse?.status ??
            error?.koiosResponse?.status_code ??
            error?.blockfrostResponse?.status ??
            error?.blockfrostResponse?.status_code
    );
    if (RETRIABLE_STATUS_CODES.has(status)) return true;

    const message = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`.toLowerCase();
    if (messageLooksRetriable(message)) return true;

    const code = `${error?.code ?? ''}`.toLowerCase();
    const causeCode = `${error?.cause?.code ?? ''}`.toLowerCase();
    if (['und_err_socket', 'econnreset', 'etimedout', 'eai_again'].includes(code)) return true;
    if (['und_err_socket', 'econnreset', 'etimedout', 'eai_again'].includes(causeCode)) return true;

    const payload = provider === 'Koios' ? error?.koiosResponse : error?.blockfrostResponse;
    const payloadMessage = `${payload?.message ?? payload?.error ?? ''}`.toLowerCase();
    if (messageLooksRetriable(payloadMessage)) return true;

    if (provider === 'Koios' && `${payload?.code ?? ''}`.toLowerCase() === 'pgrst003') return true;

    return false;
};

/** One admission/observation lifecycle for both JSON and raw-Response callers. No retries here. */
export const fetchRateLimitedResponse = <R extends RateLimitResponse>({
    rateLimitKey,
    maxRateLimitWaitMs = DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
    maxRps,
    dispatch,
    onDispatchError,
    readText
}: RateLimitedResponseOptions<R>): Promise<RateLimitedResponse<R>> => {
    const start = async (): Promise<RateLimitedResponse<R>> => {
        for (;;) {
            await waitForRateLimit(rateLimitKey, maxRateLimitWaitMs);
            // A response can extend the floor in the await continuation gap.
            // No await may separate this final check from actual dispatch.
            if (rateLimitWaitRemainingMs(rateLimitKey) > 0) continue;
            let pending: Promise<R>;
            try {
                pending = dispatch({ redirect: 'manual' });
            } catch (error) {
                if (onDispatchError) onDispatchError(error);
                throw error;
            }
            return pending.then(async (response) => {
                const headerAt = Date.now();
                const headerWait = statedWaitMs(response.headers, undefined, headerAt, response.status);
                if (headerWait !== null) recordRateLimit(rateLimitKey, headerWait, headerAt);
                let text: string;
                try {
                    text = await readText(response);
                } catch (error) {
                    // Keep the original response/error for each caller's existing body contract.
                    return { response, body: { ok: false, error }, statedWait: headerWait !== null };
                }
                const bodyAt = Date.now();
                const { value: parsed, parseError } = parseJson(text);
                const bodyWait = statedWaitMs(undefined, parsed, bodyAt, response.status);
                if (bodyWait !== null) recordRateLimit(rateLimitKey, bodyWait, bodyAt);
                return { response, body: { ok: true, text, parsed, parseError }, statedWait: headerWait !== null || bodyWait !== null };
            }, onDispatchError);
        }
    };
    return maxRps === undefined ? start() : runRateLimitedTask(rateLimitKey, maxRps, start);
};

const defaultFetch: ProviderFetcher = (url, init) => (globalThis as any).fetch(url, init);

export const fetchProviderJson = async <T>({
    provider,
    url,
    method = 'GET',
    headers,
    body,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxRps = DEFAULT_MAX_RPS,
    rateLimitKey = provider,
    maxRateLimitWaitMs = DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
    fetcher = defaultFetch
}: ProviderRequestOptions): Promise<T> => {
    let attempt = 0;
    let rateLimitWaits = 0;

    // Retry loop: exits only via return (success) or throw (non-retriable / retries exhausted).
    // eslint-disable-next-line no-constant-condition
    while (true) {
        // A wait recorded by ANY earlier call on this key (this process) is honored before calling again.
        await waitForRateLimit(rateLimitKey, maxRateLimitWaitMs);
        let rateLimited: { waitMs: number | null; error: Error } | undefined;
        try {
            const observed = await fetchRateLimitedResponse({
                rateLimitKey, maxRateLimitWaitMs, maxRps,
                dispatch: ({ redirect }) => fetcher(url, { method, headers, body, redirect }),
                readText: (response) => response.text()
            });
            if (!observed.body.ok) throw observed.body.error;
            const { response, statedWait } = observed;
            const { text: responseText, parsed, parseError } = observed.body;

            if (parseError && responseText) {
                throw createProviderError({
                    provider,
                    status: response.status,
                    httpStatus: response.status,
                    statusText: response.statusText,
                    responseText,
                    cause: parseError
                });
            }

            const payloadError = getProviderPayloadError(provider, parsed);
            if (!response.ok || payloadError) {
                const status = Number(payloadError?.status_code ?? payloadError?.status ?? response.status);
                const statusText =
                    response.statusText || `${payloadError?.error ?? payloadError?.message ?? 'Request failed'}`;
                const error = createProviderError({ provider, status, httpStatus: response.status, statusText, payload: payloadError ?? parsed, responseText });
                const waitMs = statedWait ? rateLimitWaitRemainingMs(rateLimitKey) : null;
                if (status === 429 || waitMs !== null) {
                    rateLimited = { waitMs, error };
                } else {
                    throw error;
                }
            } else {
                return parsed as T;
            }
        } catch (error: any) {
            if (error instanceof RateLimitedError || attempt >= maxRetries || !isRetriableError(provider, error)) {
                throw error;
            }
            attempt++;
            await delay(retryBaseDelayMs * attempt);
            continue;
        }

        // Rate limited: never call again before the stated time; with no stated time, stop.
        const { waitMs, error } = rateLimited;
        if (waitMs === null) throw error;
        // Sitting out a stated wait is not a blind retry, so it does not spend `maxRetries` — but it is bounded.
        if (++rateLimitWaits > MAX_RATE_LIMIT_WAITS || waitMs > maxRateLimitWaitMs) {
            throw new RateLimitedError(rateLimitKey, waitMs, error.message);
        }
    }
};

