// Provider reads the HAL BFF (and any failover consumer) depends on, against the providers' real wire
// shapes (recorded from preview). Network is the only fake: global fetch answers by URL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Blockfrost } from './Blockfrost';
import { Koios } from './Koios';
import { ChainProviderFailover } from '../failover/ChainProviderFailover';
import { buildChainProviders } from '../config';
import { protocolParametersFromChain } from '../../txBuild/blockfrost';

const params = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'previewProtocolParams.json'), 'utf8'));
const cip68 = JSON.parse(readFileSync(join(__dirname, '..', 'datum', 'fixtures', 'cip68PreviewAssets.json'), 'utf8')).assets[0];

type Reply = { status?: number; body: unknown };
type Handler = (url: string, body: any) => Reply | undefined;
let handlers: Handler[] = [];
const calls: { url: string; body: any }[] = [];
const origFetch = (globalThis as any).fetch;
beforeEach(() => {
    handlers = [];
    calls.length = 0;
    (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
        const body = init?.body ? JSON.parse(init.body) : undefined;
        calls.push({ url, body });
        const reply = handlers.map((h) => h(url, body)).find(Boolean) ?? { status: 404, body: { status_code: 404, error: 'Not Found', message: 'nope' } };
        const status = reply.status ?? 200;
        return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'ERR', text: async () => JSON.stringify(reply.body) };
    };
});
afterEach(() => {
    (globalThis as any).fetch = origFetch;
});
const on = (fragment: string, reply: (url: string, body: any) => Reply | undefined) =>
    handlers.push((url, body) => (url.includes(fragment) ? reply(url, body) : undefined));

const cfg = { network: 'preview', blockfrostApiKey: 'bf' };
const ADDR = 'addr_test1wzrm0kphxfu8c45j5ktnm4dsy3r5qc3yzp46yfmra6pk34sg8yh67';
const TX = 'aa'.repeat(32);
const CONSUMER = 'cc'.repeat(32);
const koiosRow = (i: number) => ({
    tx_hash: TX,
    tx_index: i,
    address: ADDR,
    value: '30000000',
    stake_address: null,
    payment_cred: '87b7',
    epoch_no: 1431,
    block_height: 4694612,
    block_time: 1790313854,
    datum_hash: 'c385',
    inline_datum: { bytes: 'd87980', value: {} },
    reference_script: null,
    asset_list: [{ policy_id: 'ab'.repeat(28), asset_name: '01', fingerprint: 'asset1', decimals: 0, quantity: '1' }],
    is_spent: false
});

describe('getAddressUTxOs', () => {
    it('Koios: maps address_utxos rows (`address`, not tx_info `payment_addr`) and reads every page', async () => {
        on('/address_utxos', (url) => {
            const offset = Number(new URL(url).searchParams.get('offset'));
            return { body: offset === 0 ? Array.from({ length: 1000 }, (_, i) => koiosRow(i)) : [koiosRow(1000)] };
        });
        const utxos = await new Koios(cfg).getAddressUTxOs(ADDR);
        expect(utxos).toHaveLength(1001);
        expect(utxos[1000]).toEqual({
            address: ADDR,
            amount: [
                { unit: `${'ab'.repeat(28)}01`, quantity: '1' },
                { unit: 'lovelace', quantity: '30000000' }
            ],
            inline_datum: 'd87980',
            output_index: 1000,
            tx_hash: TX,
            data_hash: 'c385',
            reference_script_hash: null,
            reference_script_cbor: null
        });
        expect(calls.map((c) => new URL(c.url).search)).toEqual(['?offset=0&limit=1000', '?offset=1000&limit=1000']);
    });

    it('Blockfrost: pages past 100 (never truncates) and an address that never received funds (404) has none', async () => {
        const bfUtxo = (i: number) => ({ address: ADDR, tx_hash: TX, output_index: i, amount: [{ unit: 'lovelace', quantity: '1' }], inline_datum: null, data_hash: null });
        on(`addresses/${ADDR}/utxos?count=100&page=1`, () => ({ body: Array.from({ length: 100 }, (_, i) => bfUtxo(i)) }));
        on(`addresses/${ADDR}/utxos?count=100&page=2`, () => ({ body: [bfUtxo(100), bfUtxo(101)] }));
        expect((await new Blockfrost(cfg).getAddressUTxOs(ADDR)).map((u) => u.output_index)).toEqual(Array.from({ length: 102 }, (_, i) => i));
        expect(await new Blockfrost(cfg).getAddressUTxOs('addr_test1unused')).toEqual([]);
    });
});

describe('getTxUtxos', () => {
    it('Koios: a tx that is not on chain is a 404 (Koios answers []), not a tx with no outputs', async () => {
        on('/tx_info', () => ({ body: [] }));
        await expect(new Koios(cfg).getTxUtxos(TX)).rejects.toMatchObject({ status: 404 });
    });
});

describe('getTxOutputConsumer', () => {
    it('Blockfrost: consumed_by_tx of the output; null while unspent; 404 for an output that does not exist', async () => {
        on(`txs/${TX}/utxos`, () => ({ body: { hash: TX, outputs: [{ ...koiosRow(0), output_index: 0, consumed_by_tx: CONSUMER }, { output_index: 1, consumed_by_tx: null, amount: [] }] } }));
        const bf = new Blockfrost(cfg);
        expect(await bf.getTxOutputConsumer(TX, 0)).toBe(CONSUMER);
        expect(await bf.getTxOutputConsumer(TX, 1)).toBeNull();
        await expect(bf.getTxOutputConsumer(TX, 7)).rejects.toMatchObject({ status: 404 });
        await expect(bf.getTxOutputConsumer('dd'.repeat(32), 0)).rejects.toMatchObject({ status: 404 });
    });

    it('Koios: finds the spending tx among the address txs from the output block on, batching tx_info', async () => {
        on('/utxo_info', (_, body) => ({ body: body._utxo_refs[0] === `${TX}#0` ? [{ ...koiosRow(0), is_spent: true }] : body._utxo_refs[0] === `${TX}#1` ? [koiosRow(1)] : [] }));
        // 60 unrelated txs precede the consumer, plus the order tx itself (same-block chaining is inclusive)
        const others = Array.from({ length: 60 }, (_, i) => i.toString(16).padStart(64, '0'));
        on('/address_txs', (url, body) => {
            expect(new URL(url).searchParams.get('order')).toBe('block_height.asc');
            expect(body).toEqual({ _addresses: [ADDR], _after_block_height: 4694612 });
            return { body: [TX, ...others, CONSUMER].map((tx_hash) => ({ tx_hash })) };
        });
        on('/tx_info', (_, body) => ({
            body: body._tx_hashes.map((h: string) => ({
                tx_hash: h,
                outputs: [],
                inputs: h === CONSUMER ? [{ tx_hash: 'ee'.repeat(32), tx_index: 0 }, { tx_hash: TX, tx_index: 0 }] : [{ tx_hash: TX, tx_index: 5 }]
            }))
        }));
        const koios = new Koios(cfg);
        expect(await koios.getTxOutputConsumer(TX, 0)).toBe(CONSUMER);
        const batches = calls.filter((c) => c.url.includes('/tx_info')).map((c) => c.body._tx_hashes.length);
        expect(batches).toEqual([50, 11]);
        expect(await koios.getTxOutputConsumer(TX, 1)).toBeNull();
        await expect(koios.getTxOutputConsumer(TX, 9)).rejects.toMatchObject({ status: 404 });
    });

    it('Koios: a spent output whose consumer cannot be found is an error, never "unspent"', async () => {
        on('/utxo_info', () => ({ body: [{ ...koiosRow(0), is_spent: true }] }));
        on('/address_txs', () => ({ body: [] }));
        await expect(new Koios(cfg).getTxOutputConsumer(TX, 0)).rejects.toThrow(/spent but no tx/);
    });
});

describe('getProtocolParameters', () => {
    it('Blockfrost and Koios (tip epoch) yield identical tx-builder parameters (recorded preview epoch 1431)', async () => {
        on('/epochs/latest/parameters', () => ({ body: params.blockfrost }));
        on('/tip', () => ({ body: params.koiosTip }));
        on('/epoch_params?_epoch_no=1431', () => ({ body: params.koiosEpochParams }));
        const fromBlockfrost = await new Blockfrost(cfg).getProtocolParameters();
        const fromKoios = await new Koios(cfg).getProtocolParameters();
        expect(fromKoios).toEqual(fromBlockfrost);
        const built = protocolParametersFromChain(fromKoios);
        expect(built.minFeeA).toBe(BigInt(44));
        expect(built.coinsPerUtxoByte).toBe(BigInt(4310));
        expect([...built.costModels.values()].map((m) => m.length)).toEqual([332, 332, 350]);
    });
});

describe('getAssetOnchainMetadata', () => {
    const policy = cip68.unit.slice(0, 56);
    const hex = cip68.unit.slice(56);
    it('Koios converts the CIP-68 reference datum to exactly what Blockfrost reports', async () => {
        on('/asset_utxos', (_, body) => {
            expect(body._asset_list).toEqual([[policy, `000643b0${hex.slice(8)}`]]);
            return { body: [{ datum_hash: null, inline_datum: { bytes: cip68.referenceDatum }, asset_list: [{ policy_id: policy, asset_name: `000643b0${hex.slice(8)}` }] }] };
        });
        on(`/assets/${cip68.unit}`, () => ({ body: { asset: cip68.unit, policy_id: policy, onchain_metadata: cip68.blockfrostOnchainMetadata } }));
        const koios = await new Koios(cfg).getAssetOnchainMetadata(policy, hex);
        expect(koios).toEqual(await new Blockfrost(cfg).getAssetOnchainMetadata(policy, hex));
        expect(koios).toEqual(cip68.blockfrostOnchainMetadata);
    });

    it('CIP-25 assets: the 721 entry on Koios; null for an unknown asset on both providers', async () => {
        const name = Buffer.from('Nessy').toString('hex');
        on('/asset_info', (_, body) => ({ body: body._asset_list[0][1] === name ? [{ minting_tx_metadata: { '721': { [policy]: { Nessy: { name: 'Nessy', image: 'ipfs://n' } } } } }] : [] }));
        expect(await new Koios(cfg).getAssetOnchainMetadata(policy, name)).toEqual({ name: 'Nessy', image: 'ipfs://n' });
        expect(await new Koios(cfg).getAssetOnchainMetadata(policy, '00')).toBeNull();
        expect(await new Blockfrost(cfg).getAssetOnchainMetadata(policy, '00')).toBeNull();
    });
});

describe('ChainProviderFailover over the concrete providers', () => {
    it('a Blockfrost outage is answered by Koios; only when both fail does the read fail', async () => {
        on('blockfrost.io', () => ({ status: 402, body: { status_code: 402, error: 'Project Over Limit', message: 'Usage is over limit.' } }));
        on('/address_utxos', () => ({ body: [koiosRow(3)] }));
        const failover = new ChainProviderFailover(buildChainProviders(cfg));
        expect((await failover.getAddressUTxOs(ADDR)).map((u) => u.output_index)).toEqual([3]);
        handlers = [() => ({ status: 402, body: { status_code: 402, error: 'Project Over Limit', message: 'Usage is over limit.' } })];
        await expect(failover.getAddressUTxOs(ADDR)).rejects.toMatchObject({ status: 402 });
    });

    it('when one provider says 404 and the other is down, the read is a 404 whichever provider was tried first', async () => {
        on('blockfrost.io', () => ({ status: 402, body: { status_code: 402, error: 'Project Over Limit', message: 'Usage is over limit.' } }));
        on('/tx_info', () => ({ body: [] }));
        for (const random of [0, 0.99]) {
            const failover = new ChainProviderFailover(buildChainProviders(cfg), { random: () => random, unhealthyCooldownMs: 0 });
            await expect(failover.getTxUtxos(TX)).rejects.toMatchObject({ status: 404 });
        }
    });

    it('a 404 falls through to the next provider but does not bench the provider that answered it', async () => {
        let now = 0;
        const order: string[] = [];
        on('blockfrost.io', () => (order.push('Blockfrost'), undefined));
        on('koios.rest', () => (order.push('Koios'), { body: [{ tx_hash: TX, outputs: [] }] }));
        const failover = new ChainProviderFailover(buildChainProviders(cfg), { now: () => now, random: () => 0.99 });
        // random 0.99 starts on Blockfrost (index 1 of the healthy pool); its 404 falls through to Koios
        expect(await failover.getTxUtxos(TX)).toEqual({ outputs: [] });
        expect(order).toEqual(['Blockfrost', 'Koios']);
        order.length = 0;
        now = 1000;
        await failover.getTxUtxos(TX);
        // Blockfrost is still in the healthy pool (a benched provider would leave only Koios to start on)
        expect(order[0]).toBe('Blockfrost');
    });
});
