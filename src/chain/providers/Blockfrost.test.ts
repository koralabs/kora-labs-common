import { Blockfrost } from './Blockfrost';

// Drive the provider through an injected fetcher (fetchProviderJson uses global fetch) by stubbing
// globalThis.fetch. Assertions target externally-visible behavior (URLs hit, parsed shape, the
// burn-freshness guard) — not implementation details.
const cfg = { network: 'preview', blockfrostApiKey: 'test-project' };

const responses: Record<string, any> = {};
const setResponse = (matcher: string, body: any, status = 200) => {
    responses[matcher] = { body, status };
};

const origFetch = (globalThis as any).fetch;
const calledUrls: string[] = [];

beforeEach(() => {
    for (const k of Object.keys(responses)) delete responses[k];
    calledUrls.length = 0;
    (globalThis as any).fetch = async (url: string) => {
        calledUrls.push(url);
        const key = Object.keys(responses).find((m) => url.includes(m));
        const entry = key ? responses[key] : { body: [], status: 200 };
        return {
            ok: entry.status >= 200 && entry.status < 300,
            status: entry.status,
            statusText: '',
            text: async () => JSON.stringify(entry.body)
        };
    };
});
afterEach(() => {
    (globalThis as any).fetch = origFetch;
});

describe('Blockfrost provider', () => {
    it('hits the network-correct host with the configured project id path', async () => {
        setResponse('blocks/latest', { height: 1, slot: 2, time: 3 });
        const bf = new Blockfrost(cfg);
        const block = await bf.getLatestBlock();
        expect(block).toEqual({ height: 1, slot: 2, time: 3 });
        expect(calledUrls[0]).toContain('https://cardano-preview.blockfrost.io/api/v0/blocks/latest');
    });

    it('getAssetUtxo returns null for a burned asset (quantity 0) without fetching the tx', async () => {
        // Burn-freshness invariant: a de-indexed/burned asset must not resolve to a stale UTxO.
        setResponse('/assets/pol001', { quantity: '0' });
        const bf = new Blockfrost(cfg);
        const utxo = await bf.getAssetUtxo('pol', '001');
        expect(utxo).toBeNull();
        // Must NOT have queried /transactions or /txs for a burned asset.
        expect(calledUrls.some((u) => u.includes('/transactions') || u.includes('/txs/'))).toBe(false);
    });

    it('getAssetUtxo resolves the current UTxO for a live asset', async () => {
        setResponse('/assets/pol001/transactions', [{ tx_hash: 'txabc' }]);
        setResponse('/assets/pol001', { quantity: '1' });
        setResponse('/txs/txabc/utxos', {
            outputs: [{ address: 'addr1', amount: [{ unit: 'pol001', quantity: '1' }], output_index: 0 }]
        });
        const bf = new Blockfrost(cfg);
        const utxo = await bf.getAssetUtxo('pol', '001');
        expect(utxo?.tx_hash).toBe('txabc');
        expect(utxo?.address).toBe('addr1');
    });

    it('getAssets drops LBL_100 reference tokens and zero-quantity entries', async () => {
        setResponse('/assets/policy/pol', [
            { asset: 'pol000de140aa', quantity: '1' }, // LBL_222-ish user token (kept)
            { asset: 'pol000643b0bb', quantity: '1' }, // LBL_100 reference token (dropped)
            { asset: 'pol000de140cc', quantity: '0' } // burned (dropped)
        ]);
        const bf = new Blockfrost(cfg);
        const assets = await bf.getAssets('pol');
        expect(assets).toEqual([{ policyId: 'pol', hex: '000de140aa' }]);
    });
});
