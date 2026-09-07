import { Koios } from './Koios';

const cfg = { network: 'preview', koiosBearerToken: 'tok' };

const responses: Record<string, any> = {};
const setResponse = (matcher: string, body: any) => {
    responses[matcher] = body;
};
const origFetch = (globalThis as any).fetch;
const calledUrls: string[] = [];

beforeEach(() => {
    for (const k of Object.keys(responses)) delete responses[k];
    calledUrls.length = 0;
    (globalThis as any).fetch = async (url: string) => {
        calledUrls.push(url);
        const key = Object.keys(responses).find((m) => url.includes(m));
        return { ok: true, status: 200, statusText: '', text: async () => JSON.stringify(key ? responses[key] : []) };
    };
});
afterEach(() => {
    (globalThis as any).fetch = origFetch;
});

describe('Koios provider', () => {
    it('uses the network-correct host (preview -> preview.koios.rest)', async () => {
        setResponse('/blocks', [{ block_height: 10, abs_slot: 20, block_time: 30 }]);
        const koios = new Koios(cfg);
        const block = await koios.getLatestBlock();
        expect(block).toEqual({ height: 10, slot: 20, time: 30 });
        expect(calledUrls[0]).toContain('https://preview.koios.rest/api/v1/blocks');
    });

    it('mainnet maps to api.koios.rest', async () => {
        setResponse('/blocks', [{ block_height: 1, abs_slot: 1, block_time: 1 }]);
        await new Koios({ network: 'mainnet' }).getLatestBlock();
        expect(calledUrls[0]).toContain('https://api.koios.rest/api/v1/blocks');
    });

    it('getAssetUtxo parses the current output for the asset from tx_info', async () => {
        setResponse('/asset_txs', [{ tx_hash: 'txk' }]);
        setResponse('/tx_info', [
            {
                tx_hash: 'txk',
                outputs: [
                    {
                        value: '2000000',
                        tx_hash: 'txk',
                        tx_index: 1,
                        asset_list: [{ policy_id: 'pol', asset_name: '001', quantity: '1' }],
                        datum_hash: null,
                        payment_addr: { bech32: 'addr1' },
                        inline_datum: { bytes: 'd8', value: null },
                        reference_script: null
                    }
                ]
            }
        ]);
        const utxo = await new Koios(cfg).getAssetUtxo('pol', '001');
        expect(utxo?.tx_hash).toBe('txk');
        expect(utxo?.address).toBe('addr1');
        expect(utxo?.inline_datum).toBe('d8');
        expect(utxo?.amount).toEqual([
            { unit: 'pol001', quantity: '1' },
            { unit: 'lovelace', quantity: '2000000' }
        ]);
    });

    it('getAssetUtxo returns null when the asset has no latest tx', async () => {
        setResponse('/asset_txs', []);
        expect(await new Koios(cfg).getAssetUtxo('pol', '001')).toBeNull();
    });
});
