import cbor from 'cbor';
import { bech32 } from 'bech32';
import {
    addressHoldings, addressPaymentHash, assertAdaTransfer, assertCip68Label, cip68Field, fetchAddressUtxos, fetchCip68ExtraFromTx,
    fetchOutputDatumCbor, fetchTxPlacement, fetchTxUtxos, hexOf, LBL_100, lovelaceOf, scriptEnterpriseAddress, waitForOutputConsumed,
    waitForTxConfirmation
} from './onChain';
import { resetRateLimits } from '../chain/transport/rateLimit';

type Routes = Record<string, unknown | (() => unknown)>;
// Fake Blockfrost at the network boundary: a path maps to a body (or a function returning one); anything else is 404.
const fixture = (routes: Routes) => {
    const paths: string[] = [];
    const chain = {
        network: 'preview' as const, blockfrostApiKey: 'offline-only',
        fetchFn: (async (url: string | URL | Request) => {
            const path = String(url).replace('https://cardano-preview.blockfrost.io/api/v0', '');
            paths.push(path);
            if (!(path in routes)) return new Response('{}', { status: 404 });
            const r = routes[path];
            return new Response(JSON.stringify(typeof r === 'function' ? r() : r), { status: 200 });
        }) as typeof fetch
    };
    return { chain, paths };
};
beforeEach(() => resetRateLimits());

const HASH = 'ab'.repeat(32);
const out = (index: number, extra: object = {}) => ({ address: 'addr_test1x', amount: [{ unit: 'lovelace', quantity: '2000000' }], output_index: index, ...extra });

describe('pure helpers', () => {
    it('hexOf and lovelaceOf', () => {
        expect(hexOf('hi')).toBe('6869');
        expect(lovelaceOf([{ unit: 'x', quantity: '5' }, { unit: 'lovelace', quantity: '7' }])).toBe(BigInt(7));
        expect(lovelaceOf([{ unit: 'x', quantity: '5' }])).toBe(BigInt(0));
    });

    it('cip68Field reads buffers, null, nested and numbers; missing key is null', () => {
        const map = new Map<Buffer, unknown>([
            [Buffer.from('a'), Buffer.from('text')], [Buffer.from('n'), null], [Buffer.from('l'), [1, 2]], [Buffer.from('i'), 42]
        ]);
        expect(cip68Field(map, 'a')).toBe('text');
        expect(cip68Field(map, 'n')).toBeNull();
        expect(cip68Field(map, 'l')).toBe('[1,2]');
        expect(cip68Field(map, 'i')).toBe('42');
        expect(cip68Field(map, 'zzz')).toBeNull();
    });

    it('scriptEnterpriseAddress round-trips through addressPaymentHash and rejects bad input', () => {
        const script = 'cd'.repeat(28);
        const test = scriptEnterpriseAddress(script, 'preview');
        const main = scriptEnterpriseAddress(script, 'mainnet');
        expect(test.startsWith('addr_test1')).toBe(true);
        expect(main.startsWith('addr1')).toBe(true);
        expect(addressPaymentHash(test)).toBe(script);
        expect(addressPaymentHash(main)).toBe(script);
        expect(() => scriptEnterpriseAddress('abc', 'preview')).toThrow('28 bytes');
        expect(() => scriptEnterpriseAddress(script, 'nope')).toThrow('unknown network');
    });

    it('addressPaymentHash rejects a prefix that disagrees with the network nibble', () => {
        const bytes = Buffer.concat([Buffer.from([0x71]), Buffer.alloc(28, 1)]);
        const wrong = bech32.encode('addr_test', bech32.toWords(bytes), 256);
        expect(() => addressPaymentHash(wrong)).toThrow('valid Shelley');
    });
});

describe('chain reads', () => {
    it('fetchTxUtxos returns the body and throws on 404', async () => {
        const { chain } = fixture({ [`/txs/${HASH}/utxos`]: { hash: HASH, inputs: [], outputs: [out(0)] } });
        expect((await fetchTxUtxos(chain, HASH)).outputs).toHaveLength(1);
        await expect(fetchTxUtxos(chain, 'ff')).rejects.toThrow('failed (404)');
    });

    it('waitForTxConfirmation confirms only once utxos are served, and times out otherwise', async () => {
        let utxoCalls = 0;
        const { chain } = fixture({
            [`/txs/${HASH}`]: { block: 'b1', valid_contract: false },
            [`/txs/${HASH}/utxos`]: () => (++utxoCalls >= 2 ? { outputs: [] } : (() => { throw new Error('x'); })())
        });
        expect(await waitForTxConfirmation(chain, HASH, 1000, 1)).toEqual({ confirmed: true, block: 'b1', validContract: false });
        const none = fixture({});
        expect(await waitForTxConfirmation(none.chain, HASH, 5, 1)).toEqual({ confirmed: false });
    });

    it('waitForOutputConsumed returns the spender, null on timeout, and throws for a missing output', async () => {
        const spent = fixture({ [`/txs/${HASH}/utxos`]: { outputs: [out(0, { consumed_by_tx: 'spender' }), out(1)] } });
        expect(await waitForOutputConsumed(spent.chain, HASH, 0, 10, 1)).toBe('spender');
        expect(await waitForOutputConsumed(spent.chain, HASH, 1, 5, 1)).toBeNull();
        await expect(waitForOutputConsumed(spent.chain, HASH, 9, 10, 1)).rejects.toThrow('does not exist');
    });

    it('assertCip68Label requires the label and forbids notLabel', async () => {
        const policy = 'aa'.repeat(28);
        const name = 'bob';
        const { chain } = fixture({
            [`/assets/${policy}000643b0${hexOf(name)}`]: { quantity: '1' },
            [`/assets/${policy}000de140${hexOf(name)}`]: { quantity: '1' },
            [`/assets/${policy}00000000${hexOf(name)}`]: { quantity: '0' },
            [`/assets/${policy}001bc280${hexOf(name)}`]: { quantity: '0' }
        });
        await expect(assertCip68Label(chain, policy, name, { hasLabel: '000643b0', notLabel: '00000000' })).resolves.toBeUndefined();
        await expect(assertCip68Label(chain, policy, name, { hasLabel: '000643b0', notLabel: '000de140' })).rejects.toThrow('must NOT exist');
        await expect(assertCip68Label(chain, policy, name, { hasLabel: '001bc280' })).rejects.toThrow('zero quantity');
        await expect(assertCip68Label(chain, policy, 'ghost', { hasLabel: '000643b0' })).rejects.toThrow('not found');
    });

    it('assertAdaTransfer sums outputs to the address and fails below the minimum', async () => {
        const { chain } = fixture({ [`/txs/${HASH}/utxos`]: { outputs: [out(0), out(1), out(2, { address: 'other' })] } });
        expect(await assertAdaTransfer(chain, HASH, 'addr_test1x', BigInt(4000000))).toBe(BigInt(4000000));
        await expect(assertAdaTransfer(chain, HASH, 'addr_test1x', BigInt(4000001))).rejects.toThrow('expected >=');
    });

    it('fetchOutputDatumCbor prefers inline, falls back to hash, else throws', async () => {
        const { chain } = fixture({ '/scripts/datum/dh/cbor': { cbor: 'beef' } });
        expect(await fetchOutputDatumCbor(chain, out(0, { inline_datum: 'aa' }))).toBe('aa');
        expect(await fetchOutputDatumCbor(chain, out(0, { data_hash: 'dh' }))).toBe('beef');
        await expect(fetchOutputDatumCbor(chain, out(3))).rejects.toThrow('no datum');
    });

    it('fetchCip68ExtraFromTx decodes the extra map of the matching output', async () => {
        const policy = 'aa'.repeat(28);
        const unit = `${policy}${LBL_100}${hexOf('bob')}`;
        const datum = cbor.encode(new cbor.Tagged(121, [new Map(), 1, new Map([[Buffer.from('k'), Buffer.from('v')]])])).toString('hex');
        const good = fixture({ [`/txs/${HASH}/utxos`]: { outputs: [out(0), { ...out(1), amount: [{ unit, quantity: '1' }], inline_datum: datum }] } });
        const extra = await fetchCip68ExtraFromTx(good.chain, HASH, 'bob');
        expect(cip68Field(extra, 'k')).toBe('v');
        await expect(fetchCip68ExtraFromTx(good.chain, HASH, 'nobody')).rejects.toThrow('no 000643b0 output');
        const noExtra = cbor.encode(new cbor.Tagged(121, [new Map(), 1, 5])).toString('hex');
        const bad = fixture({ [`/txs/${HASH}/utxos`]: { outputs: [{ ...out(0), amount: [{ unit, quantity: '1' }], inline_datum: noExtra }] } });
        await expect(fetchCip68ExtraFromTx(bad.chain, HASH, 'bob')).rejects.toThrow('no extra map');
    });

    it('fetchAddressUtxos pages until a short page; unused address is empty', async () => {
        const page = (n: number) => Array.from({ length: n }, (_, i) => ({ ...out(i), tx_hash: HASH }));
        const { chain, paths } = fixture({
            '/addresses/a/utxos?count=100&page=1': page(100),
            '/addresses/a/utxos?count=100&page=2': page(3)
        });
        expect(await fetchAddressUtxos(chain, 'a')).toHaveLength(103);
        expect(paths).toHaveLength(2);
        expect(await fetchAddressUtxos(chain, 'unused')).toEqual([]);
    });

    it('addressHoldings maps units to quantities; unused address is empty', async () => {
        const { chain } = fixture({ '/addresses/a': { amount: [{ unit: 'lovelace', quantity: '9' }, { unit: 'p1', quantity: '2' }] } });
        expect(await addressHoldings(chain, 'a')).toEqual(new Map([['lovelace', BigInt(9)], ['p1', BigInt(2)]]));
        expect((await addressHoldings(chain, 'none')).size).toBe(0);
    });

    it('fetchTxPlacement maps block fields', async () => {
        const { chain } = fixture({ [`/txs/${HASH}`]: { block_height: 10, block_time: 99, index: 3 } });
        expect(await fetchTxPlacement(chain, HASH)).toEqual({ blockHeight: 10, blockTime: 99, index: 3 });
    });
});
