import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fetchRateLimitedResponse } from '../chain/transport/fetchProviderJson';

export const ARBITER_LEASE_MS = 600_000;
export const MAX_SOLO_RUN_MS = 300_000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface LastNormalSuccess { sfo: number; rdm: number }

export interface ArbiterIdentity {
    network: string;
    name: string;
    ownerBox: string;
    token: string;
    lastNormalSuccess?: LastNormalSuccess;
}

export type ArbiterDecision =
    | { status: 'granted' | 'renewed'; deadline: number }
    | { status: 'released' | 'held' | 'draining' };

export interface CronArbiter {
    request(action: 'acquire' | 'renew' | 'release', identity: ArbiterIdentity): Promise<ArbiterDecision>;
}

/** Only this token shape selects arbiter-authorized local CQL release. */
export const arbiterOwner = (token: unknown): string | undefined => {
    if (typeof token !== 'string') return undefined;
    return /^([a-z0-9-]+):arbiter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(token)?.[1];
};

/** One signed request, no retry or blocking drain wait. Any transport/protocol failure rejects. */
export const createCronArbiter = (
    env: NodeJS.ProcessEnv = process.env,
    fetcher: typeof fetch = globalThis.fetch
): CronArbiter => ({
    async request(action, identity) {
        const endpoint = new URL(env.KORA_CRON_ARBITER_URL ?? 'https://kora-cron-arbiter.jlanderson.workers.dev');
        if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) {
            throw new Error('Cron arbiter requires HTTPS');
        }
        const secret = env.KORA_CRON_ARBITER_HMAC_SECRET;
        if (!secret) throw new Error('KORA_CRON_ARBITER_HMAC_SECRET is required for arbiter coordination');
        const url = new URL(`/v1/cron-lock/${action}`, endpoint);
        const body = JSON.stringify({ ...identity, lastNormalSuccess: identity.lastNormalSuccess ?? { sfo: 0, rdm: 0 },
            leaseMs: ARBITER_LEASE_MS, maxRunMs: MAX_SOLO_RUN_MS });
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac('sha256', secret).update(`${timestamp}.POST.${url.pathname}.${body}`).digest('hex');
        const started = performance.now();
        const observed = await fetchRateLimitedResponse({
            rateLimitKey: `cron-arbiter:${url.origin}`,
            maxRateLimitWaitMs: 0,
            dispatch: ({ redirect }) => fetcher(url, {
                method: 'POST', redirect, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), body,
                headers: { 'content-type': 'application/json', 'x-kora-timestamp': timestamp, 'x-kora-signature': signature }
            }),
            readText: response => response.text()
        });
        if (!observed.response.ok) throw new Error(`Cron arbiter HTTP ${observed.response.status}`);
        if (!observed.body.ok) throw observed.body.error;
        if (observed.body.parseError) throw new Error('Cron arbiter returned invalid JSON');
        const decision = observed.body.parsed as Record<string, unknown> | null;
        if (!decision || !Number.isSafeInteger(decision.serverNow) || !Number.isSafeInteger(decision.expiresAt)) {
            throw new Error('Cron arbiter returned invalid lease times');
        }
        const remaining = Number(decision.expiresAt) - Number(decision.serverNow);
        if ((action === 'acquire' && decision.status === 'granted') || (action === 'renew' && decision.status === 'renewed')) {
            if (remaining <= 0 || remaining > ARBITER_LEASE_MS) throw new Error('Cron arbiter returned an invalid lease duration');
            // DO clock sets expiry. Subtract the entire request time, not an assumed WAN one-way delay.
            return { status: decision.status, deadline: started + remaining } as ArbiterDecision;
        }
        if ((action === 'release' && decision.status === 'released') || decision.status === 'held' || decision.status === 'draining') {
            return { status: decision.status } as ArbiterDecision;
        }
        throw new Error('Cron arbiter returned an invalid decision');
    }
});
