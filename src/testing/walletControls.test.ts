import { resetRateLimits } from '../chain/transport/rateLimit';
import type { LiveWallet } from './liveWallet';
import { addressHoldings, addressPaymentHash, assertAssetBurned, fetchAddressUtxos, fetchTxPlacement, scriptEnterpriseAddress } from './onChain';
import { makeUnsignedWallet, UNSIGNED_WALLET_ERROR, USER_DECLINED_MESSAGE, WALLET_READ_METHODS, withWalletControls } from './walletControls';

const stubWallet = (calls: string[] = []): LiveWallet =>
    ({
        address: 'addr_test1stub',
        submittedTxHashes: [],
        submissions: [],
        call: async (method: string) => {
            calls.push(method);
            return method === 'submitTx' ? 'f'.repeat(64) : `${method}-result`;
        }
    }) as unknown as LiveWallet;

describe('withWalletControls', () => {
    it('declines exactly the next signature with a CIP-30 UserDeclined error, then signs again', async () => {
        const calls: string[] = [];
        const controls = withWalletControls(stubWallet(calls));
        controls.declineNextSignature();
        await expect(controls.wallet.call('signTx', 'aa')).rejects.toMatchObject({ message: USER_DECLINED_MESSAGE, code: 2 });
        expect(calls).toEqual([]);
        expect(await controls.wallet.call('signTx', 'aa')).toBe('signTx-result');
        controls.declineNextSignature('nope');
        await expect(controls.wallet.call('signTxs', ['aa'])).rejects.toThrow('nope');
    });

    it('submits for real, then throws once — like a relay wallet that times out after forwarding', async () => {
        const calls: string[] = [];
        const controls = withWalletControls(stubWallet(calls));
        controls.throwAfterNextSubmit('relay timeout');
        await expect(controls.wallet.call('submitTx', 'aa')).rejects.toMatchObject({ message: 'relay timeout', code: 2, info: 'relay timeout' });
        expect(calls).toEqual(['submitTx']);
        expect(await controls.wallet.call('submitTx', 'aa')).toBe('f'.repeat(64));
    });

    it('keeps the inner wallet facts (the submissions arrays are shared, not copied)', () => {
        const inner = stubWallet();
        const { wallet } = withWalletControls(inner);
        expect(wallet.address).toBe(inner.address);
        expect(wallet.submissions).toBe(inner.submissions);
    });
});

describe('makeUnsignedWallet', () => {
    it('answers every read method and refuses everything else, unknown methods included', async () => {
        const wallet = makeUnsignedWallet(stubWallet());
        for (const method of WALLET_READ_METHODS) expect(await wallet.call(method)).toBe(`${method}-result`);
        for (const method of ['signTx', 'signTxs', 'signData', 'submitTx', 'somethingNew']) {
            await expect(wallet.call(method)).rejects.toThrow(`${UNSIGNED_WALLET_ERROR}: '${method}'`);
        }
    });
});

type Route = (url: string) => { status: number; body: unknown } | undefined;
const fakeFetch = (route: Route, calls: string[] = []) =>
    (async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        const hit = route(url) ?? { status: 404, body: { status_code: 404, error: 'Not Found', message: 'not found' } };
        return new Response(JSON.stringify(hit.body), { status: hit.status });
    }) as typeof fetch;

describe('chain reads', () => {
    beforeEach(() => resetRateLimits());
    const chain = (route: Route, calls?: string[]) => ({ network: 'preview' as const, blockfrostApiKey: 'k', fetchFn: fakeFetch(route, calls) });

    it('fetchAddressUtxos reads every page and treats a never-used address as empty', async () => {
        const page1 = Array.from({ length: 100 }, (_, i) => ({ tx_hash: 'a'.repeat(64), output_index: i, amount: [] }));
        const calls: string[] = [];
        const utxos = await fetchAddressUtxos(
            chain((url) => (url.includes('page=1') ? { status: 200, body: page1 } : url.includes('page=2') ? { status: 200, body: [{ ...page1[0], output_index: 100 }] } : undefined), calls),
            'addr_test1x'
        );
        expect(utxos).toHaveLength(101);
        expect(calls).toHaveLength(2);
        expect(await fetchAddressUtxos(chain(() => undefined), 'addr_test1unused')).toEqual([]);
    });

    it('addressHoldings maps units to quantities', async () => {
        const holdings = await addressHoldings(chain(() => ({ status: 200, body: { amount: [{ unit: 'lovelace', quantity: '5' }] } })), 'addr_test1x');
        expect(holdings.get('lovelace')).toBe(BigInt(5));
        expect((await addressHoldings(chain(() => undefined), 'addr_test1unused')).size).toBe(0);
    });

    it('fetchTxPlacement reads block height, time and index', async () => {
        const placement = await fetchTxPlacement(chain(() => ({ status: 200, body: { block_height: 9, block_time: 1700, index: 2 } })), 'a'.repeat(64));
        expect(placement).toEqual({ blockHeight: 9, blockTime: 1700, index: 2 });
    });

    it('scriptEnterpriseAddress and addressPaymentHash round-trip', () => {
        const hash = 'ab'.repeat(28);
        expect(addressPaymentHash(scriptEnterpriseAddress(hash, 'preview'))).toBe(hash);
        expect(scriptEnterpriseAddress(hash, 'preview').startsWith('addr_test1w')).toBe(true);
        expect(scriptEnterpriseAddress(hash, 'mainnet').startsWith('addr1w')).toBe(true);
    });

    it('assertAssetBurned polls a lagging quantity until it reads 0, and fails when it never does', async () => {
        let reads = 0;
        await assertAssetBurned(chain(() => ({ status: 200, body: { quantity: ++reads < 3 ? '1' : '0' } })), 'unit', { timeoutMs: 1000, pollMs: 1 });
        expect(reads).toBe(3);
        await assertAssetBurned(chain(() => undefined), 'unit');
        await expect(assertAssetBurned(chain(() => ({ status: 200, body: { quantity: '1' } })), 'unit')).rejects.toThrow('expected unit burned, quantity is 1');
    });
});
