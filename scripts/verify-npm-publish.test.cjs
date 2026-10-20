'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyPublished } = require('./verify-npm-publish.cjs');

const name = '@koralabs/kora-labs-common';
const version = '6.21.4';
const published = () => new Response(JSON.stringify({ name, version }), { status: 200 });
function fixture(responses, options = {}) {
    let time = Date.UTC(2026, 9, 20);
    const requests = [];
    const waits = [];
    return {
        requests, waits,
        run: () => verifyPublished({ name, version, log: () => {}, now: () => time,
            sleep: async ms => { waits.push(ms); time += ms; },
            fetch: async (url, init) => {
                requests.push({ url, init, time });
                const response = responses[Math.min(requests.length - 1, responses.length - 1)];
                if (response instanceof Error) throw response;
                return response();
            }, ...options })
    };
}

// Each test observes actual helper outcomes and requests, not a mocked verifier.
// Negative controls: removing identity validation, polling, the deadline, or wait parsing respectively
// breaks these assertions. Only network and clock boundaries are replaced.
test('verifies the exact scoped version, not latest, without sleeping', async () => {
    const f = fixture([published]);
    assert.deepEqual(await f.run(), { name, version, attempts: 1 });
    assert.equal(f.requests[0].url, 'https://registry.npmjs.org/%40koralabs%2Fkora-labs-common/6.21.4');
    assert.equal(f.requests[0].init.redirect, 'error');
    assert.deepEqual(f.waits, []);
});

test('survives three minutes of propagation and returns only once exact metadata appears', async () => {
    const f = fixture([...Array.from({ length: 12 }, () => () => new Response('{}', { status: 404 })), published]);
    assert.equal((await f.run()).attempts, 13);
    assert.deepEqual(f.waits, Array(12).fill(15_000));
});

test('missing or wrong package metadata fails within a bounded window', async () => {
    for (const response of [() => new Response('{}', { status: 404 }),
        () => new Response(JSON.stringify({ name, version: '6.21.3' })),
        () => new Response(JSON.stringify({ name: 'impostor', version })),
        () => new Response('not JSON')]) {
        const f = fixture([response], { deadlineMs: 45_000 });
        await assert.rejects(f.run(), /npm verification failed.*deadline exhausted/);
        assert.equal(f.requests.length, 3);
        assert.deepEqual(f.waits, [15_000, 15_000]);
    }
});

test('provider waits are honored on the next request, including dates, resets and body hints', async () => {
    const cases = [
        [{ 'retry-after': '45' }, {}, 45_000],
        [{ 'retry-after': new Date(Date.UTC(2026, 9, 20) + 60_000).toUTCString() }, {}, 60_000],
        [{ 'x-ratelimit-reset-after': '33.5' }, {}, 33_500],
        [{ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 9, 20) / 1000 + 70) }, {}, 70_000],
        [{ 'ratelimit-remaining': '0', 'ratelimit-reset': '50' }, {}, 50_000],
        [{}, { retry_after: 22.5 }, 22_500],
        [{}, { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' }] } }, 41_000],
        [{ 'retry-after': '20', 'x-ratelimit-reset-after': '75' }, { retry_after: 30 }, 75_000]
    ];
    for (const [headers, body, expected] of cases) {
        const f = fixture([() => new Response(JSON.stringify(body), { status: 429, headers }), published]);
        assert.equal((await f.run()).attempts, 2);
        assert.deepEqual(f.waits, [expected]);
        assert.equal(f.requests[1].time - f.requests[0].time, expected);
    }
});

test('a wait beyond the deadline stops with the provider delay instead of retrying early', async () => {
    const f = fixture([() => new Response('{}', { status: 429, headers: { 'retry-after': '600' } }), published]);
    await assert.rejects(f.run(), /provider requires waiting 600s/);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.waits, []);
});

test('retains header waits when body reading fails', async () => {
    const f = fixture([() => ({ status: 429, headers: new Headers({ 'retry-after': '65' }),
        text: async () => { throw new Error('broken body'); } }), published]);
    assert.equal((await f.run()).attempts, 2);
    assert.deepEqual(f.waits, [65_000]);
});

test('network failures and server errors retry, but authorization errors fail immediately', async () => {
    const transient = fixture([new Error('connection reset'), () => new Response('{}', { status: 503 }), published]);
    assert.equal((await transient.run()).attempts, 3);
    assert.deepEqual(transient.waits, [15_000, 15_000]);
    const unauthorized = fixture([() => new Response('{}', { status: 403 }), published]);
    await assert.rejects(unauthorized.run(), /Non-retryable.*403/);
    assert.equal(unauthorized.requests.length, 1);
    assert.deepEqual(unauthorized.waits, []);
});
