import { Koios } from './Koios';

const origFetch = (globalThis as any).fetch;
const responses: Record<string, any> = {};
beforeEach(() => {
    for (const k of Object.keys(responses)) delete responses[k];
    (globalThis as any).fetch = async (url: string) => {
        const key = Object.keys(responses).find((m) => url.includes(m));
        return { ok: true, status: 200, statusText: '', text: async () => JSON.stringify(key ? responses[key] : []) };
    };
});
afterEach(() => {
    (globalThis as any).fetch = origFetch;
});
const koios = () => new Koios({ network: 'preview', koiosBearerToken: 'tok' });

describe('Koios read paths', () => {
    it('getAssetsByStakeKey concatenates policy+name and drops zero-quantity rows', async () => {
        responses['/account_assets'] = [
            { stake_address: 's', policy_id: 'aa', asset_name: '01', quantity: '5' },
            { stake_address: 's', policy_id: 'bb', asset_name: '02', quantity: '0' }
        ];
        expect(await koios().getAssetsByStakeKey('s')).toEqual([{ asset: 'aa01', amount: '5' }]);
    });

    it('getAssetMetadata prefers hex key, then utf8 name key, then token registry logo', async () => {
        const hex = Buffer.from('abc').toString('hex');
        responses['/asset_info'] = [{ minting_tx_metadata: { '721': { pol: { [hex]: { image: 'byhex' } } } } }];
        expect(await koios().getAssetMetadata('pol', hex)).toEqual({ image: 'byhex' });
        responses['/asset_info'] = [{ minting_tx_metadata: { '721': { pol: { abc: { image: 'byname' } } } } }];
        expect(await koios().getAssetMetadata('pol', hex)).toEqual({ image: 'byname' });
        responses['/asset_info'] = [{ token_registry_metadata: { logo: 'LOGO' } }];
        expect(await koios().getAssetMetadata('pol', hex)).toEqual({ image: 'data:image/png;base64,LOGO' });
        responses['/asset_info'] = [{}];
        expect(await koios().getAssetMetadata('pol', hex)).toBeUndefined();
    });

    it('getCip25AssetImage joins chunked image arrays and returns null without metadata', async () => {
        responses['/asset_info'] = [{ minting_tx_metadata: { '721': { pol: { '00': { image: ['ipfs://', 'Qm1'] } } } } }];
        expect(await koios().getCip25AssetImage('pol', '00')).toBe('ipfs://Qm1');
        responses['/asset_info'] = [{}];
        expect(await koios().getCip25AssetImage('pol', '00')).toBeNull();
    });

    it('getAddressInfo sums per-unit balances and sorts assets by unit after lovelace', async () => {
        responses['/address_info'] = [
            {
                address: 'addr1',
                balance: '7',
                stake_address: 'stake1',
                script_address: false,
                utxo_set: [
                    { asset_list: [{ policy_id: 'bb', asset_name: '02', quantity: '1' }, { policy_id: 'aa', asset_name: null, quantity: '2' }] },
                    { asset_list: [{ policy_id: 'bb', asset_name: '02', quantity: '4' }] },
                    {}
                ]
            }
        ];
        const info = await koios().getAddressInfo('addr1');
        expect(info.amount).toEqual([
            { unit: 'lovelace', quantity: '7' },
            { unit: 'aa', quantity: '2' },
            { unit: 'bb02', quantity: '5' }
        ]);
        expect(info.stake_address).toBe('stake1');
    });

    it('getTxUtxos throws not-found for an unknown transaction', async () => {
        responses['/tx_info'] = [];
        await expect(koios().getTxUtxos('deadbeef')).rejects.toThrow(/deadbeef/);
    });
});
