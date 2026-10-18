import { createHmac } from 'node:crypto';
import { createCronArbiter, ARBITER_LEASE_MS, MAX_SOLO_RUN_MS } from './arbiter';
import { resetRateLimits } from '../chain/transport/rateLimit';

const identity = { network: 'preview', name: 'lock.mintPaidSessionsLock', ownerBox: 'rdm', token: 'rdm:arbiter:unique' };
const env = { KORA_CRON_ARBITER_URL: 'https://arbiter.invalid', KORA_CRON_ARBITER_HMAC_SECRET: 'unit-secret' };
const reply = (status: string) => new Response(JSON.stringify({ status, serverNow: 1000, expiresAt: 601000 }), { status: 200 });
beforeEach(() => resetRateLimits());

// Invariant: the exact scope, operation, token and body are authenticated before dispatch.
// Failure caught: signing only a URL lets an authenticated acquire be replayed with a different owner/body.
// Negative control: remove body or path from the signature and the independent HMAC assertion fails.
it('signs every exact request field and does not follow redirects', async () => {
    let request: RequestInit | undefined;
    let target = '';
    const fetcher = (async (url, init) => { target = String(url); request = init; return reply('granted'); }) as typeof fetch;
    const arbiter = createCronArbiter(env, fetcher);
    const result = await arbiter.request('acquire', identity);
    expect(result.status).toBe('granted');
    expect(target).toBe('https://arbiter.invalid/v1/cron-lock/acquire');
    expect(request!.redirect).toBe('manual');
    expect(JSON.parse(String(request!.body))).toEqual({ ...identity, lastNormalSuccess: { sfo: 0, rdm: 0 }, leaseMs: ARBITER_LEASE_MS, maxRunMs: MAX_SOLO_RUN_MS });
    const headers = new Headers(request!.headers);
    const expected = createHmac('sha256', 'unit-secret').update(`${headers.get('x-kora-timestamp')}.POST./v1/cron-lock/acquire.${request!.body}`).digest('hex');
    expect(headers.get('x-kora-signature')).toBe(expected);
});

// Invariant: missing credentials or an untrusted/ambiguous response cannot authorize solo work.
// Failure caught: HTTP errors, wrong-operation responses or malformed expiry are accepted as grants.
// Negative control: accepting any status/body makes the corresponding rejection assertion fail.
it.each([
    new Response('unavailable', { status: 503 }),
    new Response('moved', { status: 302, headers: { location: 'https://other.invalid' } }),
    new Response('{'),
    reply('renewed'),
    new Response(JSON.stringify({ status: 'granted', serverNow: 1000, expiresAt: 1000 })),
    new Response(JSON.stringify({ status: 'granted', serverNow: 1000, expiresAt: 9999999 }))
])('rejects a response that does not establish an acquisition', async response => {
    await expect(createCronArbiter(env, (async () => response) as typeof fetch).request('acquire', identity)).rejects.toThrow();
});

it('rejects missing authentication before making a network call', async () => {
    let dispatched = 0;
    const arbiter = createCronArbiter({}, (async () => { dispatched++; return reply('granted'); }) as typeof fetch);
    await expect(arbiter.request('acquire', identity)).rejects.toThrow('HMAC_SECRET');
    expect(dispatched).toBe(0);
});

// Invariant: drain/held decisions are returned immediately; natural requests, not a blocking Fn, revisit them.
// Failure caught: client sleeps through 300s drain inside a 300s Fn or treats an expired release as a grant.
// Negative control: interpreting draining as granted changes the externally visible decision.
it.each(['draining', 'held'])('returns %s without a retry', async status => {
    let calls = 0;
    const arbiter = createCronArbiter(env, (async () => { calls++; return reply(status); }) as typeof fetch);
    expect(await arbiter.request('acquire', identity)).toEqual({ status });
    expect(calls).toBe(1);
});

it('allows a released decision with no remaining lease', async () => {
    const response = new Response(JSON.stringify({ status: 'released', serverNow: 1000, expiresAt: 0 }));
    expect(await createCronArbiter(env, (async () => response) as typeof fetch).request('release', identity)).toEqual({ status: 'released' });
});

// Invariant: an arbiter rate-limit response is remembered across separate callers with no early retry.
// Failure caught: different invocations spend quota again after a 429 states its wait.
// Negative control: remove shared observation/admission and the second dispatch count becomes two.
it('honors the process-shared rate floor without blocking or retrying', async () => {
    let calls = 0;
    const arbiter = createCronArbiter(env, (async () => {
        calls++;
        return new Response(JSON.stringify({ retry_after: 60 }), { status: 429 });
    }) as typeof fetch);
    await expect(arbiter.request('acquire', identity)).rejects.toThrow('HTTP 429');
    await expect(arbiter.request('release', identity)).rejects.toThrow();
    expect(calls).toBe(1);
});
