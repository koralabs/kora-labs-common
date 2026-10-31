import { makeReadOnlyWallet, READ_ONLY_GUARD_ERROR } from './readOnlyGuard';
import type { LiveWallet } from './liveWallet';

const makeInner = () => {
    const calls: [string, unknown][] = [];
    const inner = {
        extra: 'kept',
        call: async (method: string, params?: unknown) => {
            calls.push([method, params]);
            return `ok:${method}`;
        }
    } as unknown as LiveWallet;
    return { inner, calls };
};

describe('makeReadOnlyWallet', () => {
    it('passes read calls through and never records them', async () => {
        const { inner, calls } = makeInner();
        const ro = makeReadOnlyWallet(inner);
        expect(await ro.wallet.call('getUtxos', 'x')).toBe('ok:getUtxos');
        expect(calls).toEqual([['getUtxos', 'x']]);
        expect(ro.reachedSign()).toBe(false);
        expect((ro.wallet as unknown as { extra: string }).extra).toBe('kept');
    });

    it.each([
        ['signTx', 'aa', ['aa']],
        ['submitTx', 'bb', ['bb']],
        ['signTxs', ['c1', { cbor: 'c2' }, { tx: 'c3' }, {}, undefined, 7], ['c1', 'c2', 'c3']],
        ['signTx', undefined, []]
    ])('blocks %s, throws, records presented cbors, never reaches the inner wallet', async (method, params, expected) => {
        const { inner, calls } = makeInner();
        const ro = makeReadOnlyWallet(inner);
        await expect(ro.wallet.call(method, params)).rejects.toThrow(READ_ONLY_GUARD_ERROR);
        expect(calls).toEqual([]);
        expect(ro.reachedSign()).toBe(true);
        expect(ro.signRequests[0].method).toBe(method);
        expect(ro.signRequests[0].txCbors).toEqual(expected);
        expect(ro.signRequests[0].txCbor).toBe(expected[0] ?? '');
    });

    it('reset clears recorded requests', async () => {
        const ro = makeReadOnlyWallet(makeInner().inner);
        await ro.wallet.call('signTx', 'aa').catch(() => undefined);
        ro.reset();
        expect(ro.reachedSign()).toBe(false);
    });

    it('waitForSignRequest times out false, and returns true once a sign is attempted by tick', async () => {
        const ro = makeReadOnlyWallet(makeInner().inner);
        expect(await ro.waitForSignRequest(0)).toBe(false);
        let ticks = 0;
        const found = await ro.waitForSignRequest(10000, async () => {
            ticks++;
            await ro.wallet.call('signTx', 'zz').catch(() => undefined);
        });
        expect(found).toBe(true);
        expect(ticks).toBe(1);
    });
});
