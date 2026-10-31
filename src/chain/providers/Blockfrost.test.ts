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

describe('Blockfrost provider: lookups and paging', () => {
    it('getAssetUtxo returns null when the latest tx lists the asset only as an input, or has no tx at all', async () => {
        setResponse('/assets/pol001/transactions', [{ tx_hash: 'txin' }]);
        setResponse('/assets/pol001', { quantity: '1' });
        setResponse('/txs/txin/utxos', { outputs: [{ address: 'a', amount: [{ unit: 'other', quantity: '1' }], output_index: 0 }] });
        expect(await new Blockfrost(cfg).getAssetUtxo('pol', '001')).toBeNull();

        setResponse('/assets/pol001/transactions', []);
        expect(await new Blockfrost(cfg).getAssetUtxo('pol', '001')).toBeNull();
        expect(await new Blockfrost(cfg).getLatestTransactionForAsset('pol', '001')).toBeNull();
    });

    it('getAssetDatum and getDatumFromHash return inline/cbor datums, and null for unknown ones', async () => {
        setResponse('/assets/pol001/transactions', [{ tx_hash: 'tx1' }]);
        setResponse('/assets/pol001', { quantity: '1' });
        setResponse('/txs/tx1/utxos', { outputs: [{ amount: [{ unit: 'pol001' }], inline_datum: 'd87980' }] });
        const bf = new Blockfrost(cfg);
        expect(await bf.getAssetDatum('pol', '001')).toBe('d87980');

        setResponse('/scripts/datum/h1/cbor', { cbor: '40' });
        expect(await bf.getDatumFromHash('h1')).toBe('40');
        setResponse('/scripts/datum/h2/cbor', { status: 'x' });
        expect(await bf.getDatumFromHash('h2')).toBeNull();
    });

    it('getCip25AssetImage joins chunked image arrays and returns null when there is no image', async () => {
        setResponse('/assets/polchunk', { onchain_metadata: { image: ['ipfs://', 'Qm1'] } });
        setResponse('/assets/polplain', { onchain_metadata: { image: 'ipfs://Qm2' } });
        setResponse('/assets/polnone', {});
        const bf = new Blockfrost(cfg);
        expect(await bf.getCip25AssetImage('pol', 'chunk')).toBe('ipfs://Qm1');
        expect(await bf.getCip25AssetImage('pol', 'plain')).toBe('ipfs://Qm2');
        expect(await bf.getCip25AssetImage('pol', 'none')).toBeNull();
    });

    it('getRefScriptCbor resolves the script hash from the output holding the asset', async () => {
        setResponse('/txs/txr/utxos', { outputs: [{ amount: [{ unit: 'pol01' }], reference_script_hash: 'sh1' }] });
        setResponse('/scripts/sh1/cbor', { cbor: 'abcd' });
        expect(await new Blockfrost(cfg).getRefScriptCbor('txr', 'pol', '01')).toBe('abcd');
    });

    it('getAssetsByStakeKey pages until an empty page and maps unit/quantity', async () => {
        const bf = new Blockfrost(cfg);
        (globalThis as any).fetch = async (url: string) => {
            calledUrls.push(url);
            const page = Number(new URL(url).searchParams.get('page'));
            const body = page === 1 ? [{ unit: 'u1', quantity: '2' }] : [];
            return { ok: true, status: 200, statusText: '', text: async () => JSON.stringify(body) };
        };
        expect(await bf.getAssetsByStakeKey('stake1')).toEqual([{ asset: 'u1', amount: '2' }]);
        expect(calledUrls.map((u) => new URL(u).searchParams.get('page'))).toEqual(['1', '2']);
    });

    it('getBackgroundImageDetails falls back to on-chain metadata when no datum exists, mapping 222/444 to the 100 reference token', async () => {
        setResponse('/assets/pol000643b0aa/transactions', []);
        setResponse('/assets/pol000643b0aa', { quantity: '1' });
        setResponse('/assets/pol000de140aa', { onchain_metadata: { image: 'ipfs://bg', name: 'n' } });
        const bf = new Blockfrost(cfg);
        const details = await bf.getBackgroundImageDetails('pol', '000de140aa');
        expect(details).toEqual({ image: 'ipfs://bg', metadata: { image: 'ipfs://bg', name: 'n' } });
        // the datum lookup went to the 100-label reference asset, not the user token
        expect(calledUrls.some((u) => u.includes('/assets/pol000643b0aa'))).toBe(true);
    });

    it('getAddressInfo keeps only the address summary fields', async () => {
        setResponse('/addresses/addr1', { address: 'addr1', amount: [{ unit: 'lovelace', quantity: '5' }], stake_address: 'stake1', script: false, extra: 'x' });
        expect(await new Blockfrost(cfg).getAddressInfo('addr1')).toEqual({
            address: 'addr1',
            amount: [{ unit: 'lovelace', quantity: '5' }],
            stake_address: 'stake1',
            script: false
        });
    });

    it('getAddressUTxOs pages through full pages, treats a never-funded 404 as empty, and rethrows other errors', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ tx_hash: `t${i}` }));
        const serve = (handler: (page: number) => { status: number; body: any }) => {
            (globalThis as any).fetch = async (url: string) => {
                const { status, body } = handler(Number(new URL(url).searchParams.get('page')));
                return { ok: status < 300, status, statusText: 'x', text: async () => JSON.stringify(body) };
            };
        };
        serve((p) => ({ status: 200, body: p === 1 ? full : [{ tx_hash: 'last' }] }));
        const all = await new Blockfrost(cfg).getAddressUTxOs('addr1');
        expect(all).toHaveLength(101);
        expect((all[100] as any).tx_hash).toBe('last');

        serve(() => ({ status: 404, body: { status_code: 404, message: 'not found' } }));
        expect(await new Blockfrost(cfg).getAddressUTxOs('addr1')).toEqual([]);

        serve(() => ({ status: 403, body: { status_code: 403, message: 'forbidden' } }));
        await expect(new Blockfrost(cfg).getAddressUTxOs('addr1')).rejects.toBeDefined();
    });

    it('getProtocolParameters stringifies numeric costs and defaults the ref-script fee to null', async () => {
        setResponse('epochs/latest/parameters', {
            epoch: 5, min_fee_a: 44, min_fee_b: 155381, max_tx_size: 16384, coins_per_utxo_size: 4310, key_deposit: 2000000,
            price_mem: 0.0577, price_step: 0.0000721, max_tx_ex_mem: 14000000, max_tx_ex_steps: 10000000000, cost_models_raw: { PlutusV3: [1] }
        });
        const p = await new Blockfrost(cfg).getProtocolParameters();
        expect(p.coins_per_utxo_size).toBe('4310');
        expect(p.max_tx_ex_steps).toBe('10000000000');
        expect(p.min_fee_ref_script_cost_per_byte).toBeNull();
        expect(p.cost_models_raw).toEqual({ PlutusV3: [1] });
    });

    it('getTxOutputConsumer returns the consuming tx or null for unspent outputs, and throws not-found for a missing output index', async () => {
        setResponse('/txs/txc/utxos', { outputs: [{ output_index: 0, consumed_by_tx: 'spender' }, { output_index: 1 }] });
        const bf = new Blockfrost(cfg);
        expect(await bf.getTxOutputConsumer('txc', 0)).toBe('spender');
        expect(await bf.getTxOutputConsumer('txc', 1)).toBeNull();
        await expect(bf.getTxOutputConsumer('txc', 9)).rejects.toMatchObject({ status: 404 });
    });

    it('getAssetOnchainMetadata returns metadata, null when absent or 404, and rethrows other failures', async () => {
        setResponse('/assets/polm1', { onchain_metadata: { name: 'x' } });
        setResponse('/assets/polm2', {});
        const bf = new Blockfrost(cfg);
        expect(await bf.getAssetOnchainMetadata('pol', 'm1')).toEqual({ name: 'x' });
        expect(await bf.getAssetOnchainMetadata('pol', 'm2')).toBeNull();
        setResponse('/assets/polm3', { status_code: 404, message: 'nf' }, 404);
        expect(await bf.getAssetOnchainMetadata('pol', 'm3')).toBeNull();
        setResponse('/assets/polm4', { status_code: 403, message: 'no' }, 403);
        await expect(bf.getAssetOnchainMetadata('pol', 'm4')).rejects.toBeDefined();
    });

    it('getDrepMetadata hits the governance endpoint', async () => {
        setResponse('/governance/dreps/drep1/metadata', { drep_id: 'drep1', json_metadata: {} });
        expect((await new Blockfrost(cfg).getDrepMetadata('drep1')).drep_id).toBe('drep1');
    });
});
