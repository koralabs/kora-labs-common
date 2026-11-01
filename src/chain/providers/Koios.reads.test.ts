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

    it('getAssets skips CIP-68 reference tokens and burned (zero supply) assets', async () => {
        responses['/policy_asset_list'] = [
            { asset_name: '000643b0aa', total_supply: '1' },
            { asset_name: '000de140bb', total_supply: '1' },
            { asset_name: 'cc', total_supply: '0' }
        ];
        expect(await koios().getAssets('pol')).toEqual([{ policyId: 'pol', hex: '000de140bb' }]);
        responses['/policy_asset_list'] = { error: 'x' };
        expect(await koios().getAssets('pol')).toEqual([]);
    });

    it('getLatestTransactionForAsset returns the first tx hash or null', async () => {
        responses['/asset_txs'] = [{ tx_hash: 'h1' }, { tx_hash: 'h0' }];
        expect(await koios().getLatestTransactionForAsset('pol', '00')).toBe('h1');
        responses['/asset_txs'] = [];
        expect(await koios().getLatestTransactionForAsset('pol', '00')).toBeNull();
    });

    it('getAssetDatum prefers inline datum, falls back to the datum hash lookup, else null', async () => {
        const asset = [{ policy_id: 'pol', asset_name: '00' }];
        responses['/asset_utxos'] = [{ datum_hash: 'dh', inline_datum: { bytes: 'INLINE' }, asset_list: asset }];
        expect(await koios().getAssetDatum('pol', '00')).toBe('INLINE');
        responses['/asset_utxos'] = [{ datum_hash: 'dh', asset_list: asset }];
        responses['/datum_info'] = [{ bytes: 'BYHASH' }];
        expect(await koios().getAssetDatum('pol', '00')).toBe('BYHASH');
        responses['/datum_info'] = [];
        expect(await koios().getDatumFromHash('dh')).toBeNull();
        responses['/asset_utxos'] = [{ datum_hash: null, asset_list: asset }];
        expect(await koios().getAssetDatum('pol', '00')).toBeNull();
        responses['/asset_utxos'] = [{ datum_hash: 'dh', asset_list: [{ policy_id: 'other', asset_name: '00' }] }];
        expect(await koios().getAssetDatum('pol', '00')).toBeNull();
    });

    it('getAssetUtxo maps the output holding the asset, and is null when no tx or no holder', async () => {
        responses['/asset_txs'] = [];
        expect(await koios().getAssetUtxo('pol', '00')).toBeNull();
        responses['/asset_txs'] = [{ tx_hash: 'h1' }];
        responses['/tx_info'] = [
            {
                tx_hash: 'h1',
                outputs: [
                    { address: 'other', asset_list: [], value: '1', tx_index: 0 },
                    {
                        address: 'addr_holder',
                        asset_list: [{ policy_id: 'pol', asset_name: '00', quantity: '1' }],
                        value: '2000000',
                        tx_index: 3,
                        inline_datum: { bytes: 'D' },
                        datum_hash: 'dh'
                    }
                ]
            }
        ];
        expect(await koios().getAssetUtxo('pol', '00')).toEqual({
            address: 'addr_holder',
            amount: [
                { unit: 'pol00', quantity: '1' },
                { unit: 'lovelace', quantity: '2000000' }
            ],
            inline_datum: 'D',
            output_index: 3,
            tx_hash: 'h1',
            data_hash: 'dh'
        });
        responses['/tx_info'] = [{ tx_hash: 'h1', outputs: [{ address: 'o', asset_list: [], value: '1', tx_index: 0 }] }];
        expect(await koios().getAssetUtxo('pol', '00')).toBeNull();
    });
});
