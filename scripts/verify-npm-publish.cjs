#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

const DEADLINE_MS = 5 * 60_000;
const POLL_MS = 15_000;
const REQUEST_MS = 15_000;

function seconds(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number * 1000 : 0;
}

// Take the longest advertised wait, never an average or a capped provider delay.
function providerWaitMs(headers, body, now) {
    const retry = headers.get('retry-after');
    const waits = [seconds(retry), seconds(headers.get('x-ratelimit-reset-after'))];
    if (retry && !Number.isFinite(Number(retry))) waits.push(Math.max(0, Date.parse(retry) - now) || 0);
    if (headers.get('x-ratelimit-remaining') === '0' || headers.get('ratelimit-remaining') === '0') {
        const epoch = seconds(headers.get('x-ratelimit-reset'));
        if (epoch) waits.push(Math.max(0, epoch - now));
        // RateLimit-Reset is a delta in seconds; X-RateLimit-Reset is Unix time.
        waits.push(seconds(headers.get('ratelimit-reset')));
    }
    waits.push(seconds(body?.retry_after));
    for (const detail of body?.error?.details || []) {
        if (typeof detail.retryDelay === 'string' && /^\d+(?:\.\d+)?s$/.test(detail.retryDelay)) {
            waits.push(seconds(detail.retryDelay.slice(0, -1)));
        }
    }
    return Math.max(...waits);
}

async function verifyPublished({ name, version, fetch: request = globalThis.fetch, now = Date.now,
    sleep: delay = sleep, log = console.log, deadlineMs = DEADLINE_MS, pollMs = POLL_MS }) {
    if (!name || !version) throw new Error('Expected package name and exact version');
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
    const deadline = now() + deadlineMs;
    let attempts = 0;
    let last = 'not queried';
    while (now() < deadline) {
        attempts++;
        let wait = 0;
        const controller = new AbortController();
        const timeoutMs = Math.min(REQUEST_MS, deadline - now());
        let timer;
        try {
            // Bound headers AND body reading, even if a fetch implementation ignores cancellation.
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`registry request exceeded ${timeoutMs}ms`));
                }, timeoutMs);
            });
            const result = await Promise.race([(async () => {
                const response = await request(url, { signal: controller.signal, redirect: 'error',
                    headers: { accept: 'application/json', 'cache-control': 'no-cache', 'user-agent': 'koralabs-publish-verifier/1' } });
                // Record header waits before reading a possibly broken response body.
                wait = providerWaitMs(response.headers, null, now());
                const text = await response.text();
                let body;
                try { body = JSON.parse(text); } catch { /* Report malformed registry data below. */ }
                wait = Math.max(wait, providerWaitMs(response.headers, body, now()));
                return { response, body };
            })(), timeout]);
            const { response, body } = result;
            if (response.status === 200 && body?.name === name && body?.version === version) {
                log(`Verified ${name}@${version} on npm after ${attempts} request(s).`);
                return { attempts, name, version };
            }
            last = `HTTP ${response.status}${response.status === 200 ? ' with missing or mismatched package identity' : ''}`;
            if (response.status !== 200 && response.status !== 404 && response.status !== 429 && response.status < 500) {
                throw new Error(`Non-retryable registry response: ${last}`);
            }
        } catch (error) {
            if (error.message.startsWith('Non-retryable registry response:')) throw error;
            last = error.message;
        } finally {
            clearTimeout(timer);
        }
        const remaining = deadline - now();
        const next = Math.max(pollMs, wait);
        if (next >= remaining) {
            const reason = wait >= remaining ? `provider requires waiting ${Math.ceil(wait / 1000)}s, beyond the remaining verification window` : 'verification deadline exhausted';
            throw new Error(`npm verification failed for ${name}@${version}: ${last}; ${reason} (${attempts} request(s)).`);
        }
        log(`Waiting ${Math.ceil(next / 1000)}s for ${name}@${version}: ${last}.`);
        await delay(next);
    }
    throw new Error(`npm verification failed for ${name}@${version}: ${last}; verification deadline exhausted (${attempts} request(s)).`);
}

module.exports = { verifyPublished, providerWaitMs };
if (require.main === module) {
    const { name, version } = JSON.parse(readFileSync(process.argv[2] || 'package.json', 'utf8'));
    verifyPublished({ name, version }).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
