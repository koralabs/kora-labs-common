import { asyncForEach } from '../../utils';

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

type ProviderFetcher = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string> }>;

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
    body?: string;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    maxRps?: number;
    rateLimitKey?: string;
    fetcher?: ProviderFetcher;
}

const DEFAULT_MAX_RPS = 5;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

const RETRIABLE_STATUS_CODES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const RETRIABLE_MESSAGE_SNIPPETS = [
    'terminated',
    'socket',
    'econnreset',
    'fetch failed',
    'gateway timeout',
    'too many requests',
    'payload too large',
    'timed out acquiring connection from connection pool',
    'rate limit',
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

            await asyncForEach(
                pending,
                async (queuedTask) => {
                    try {
                        const value = await queuedTask.task();
                        queuedTask.resolve(value);
                    } catch (error) {
                        queuedTask.reject(error);
                    }
                },
                delayInMilliseconds
            );
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

const createProviderError = ({
    provider,
    status,
    statusText,
    payload,
    responseText,
    cause
}: {
    provider: ProviderName;
    status: number;
    statusText: string;
    payload?: unknown;
    responseText?: string;
    cause?: Error;
}): Error => {
    const error: any = new Error(`${provider} request failed: ${status} ${statusText}`.trim());
    if (cause) error.cause = cause;
    error.status = status;
    error.statusText = statusText;
    if (payload !== undefined) {
        error[`${provider.toLowerCase()}Response`] = payload;
    }
    if (responseText) {
        error.responseText = responseText.slice(0, 512);
    }
    return error;
};

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
    fetcher = defaultFetch
}: ProviderRequestOptions): Promise<T> => {
    let attempt = 0;

    while (true) {
        try {
            const response = await runRateLimitedTask(rateLimitKey, maxRps, () => fetcher(url, { method, headers, body }));

            const responseText = await response.text();
            const { value: parsed, parseError } = parseJson(responseText);

            if (parseError && responseText) {
                throw createProviderError({
                    provider,
                    status: response.status,
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
                throw createProviderError({ provider, status, statusText, payload: payloadError ?? parsed, responseText });
            }

            return parsed as T;
        } catch (error: any) {
            if (attempt >= maxRetries || !isRetriableError(provider, error)) {
                throw error;
            }
            attempt++;
            await delay(retryBaseDelayMs * attempt);
        }
    }
};
