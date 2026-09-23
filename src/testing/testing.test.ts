import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import vm from 'node:vm';
import { mergeWitnessSet, txHashFromCbor } from '../tx';
import { buildCip30InitScript, createBridgeHandler, installLiveCip30Wallet } from './installWallet';
import { createLiveWallet, LiveWallet } from './liveWallet';
import { assertAdaTransfer, assertCip68Label, hexOf, LBL_100, LBL_222, waitForTxConfirmation } from './onChain';
import { makeReadOnlyWallet } from './readOnlyGuard';

// The CIP-19 test-vector payment key (addr_vk1w0l2sr2z...) is this mnemonic's m/1852'/1815'/0'/0/0 key,
// so the CIP-19 enterprise address pins payment derivation. (The CIP-19 stake vector uses an unrelated key.)
const MNEMONIC = 'test walk nut penalty hip pave soap entry language right filter choice';
const CIP19_ENTERPRISE_ADDRESS = 'addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz';
const CIP19_PAYMENT_KEY_HASH = '9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e';

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

const fakeFetch = (route: Route, calls: string[] = []) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        const hit = route(url, init) ?? { status: 404, body: { error: 'Not Found' } };
        return new Response(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body), { status: hit.status });
    }) as typeof fetch;

const utxo = (txHash: string, index: number, lovelace: number) => ({
    tx_hash: txHash,
    output_index: index,
    amount: [{ unit: 'lovelace', quantity: String(lovelace) }]
});

const unsignedTx = (requiredSigners: string[] = []) =>
    Serialization.Transaction.fromCore({
        id: '0'.repeat(64),
        body: {
            inputs: [{ txId: 'a'.repeat(64), index: 0 }],
            outputs: [{ address: Cardano.PaymentAddress(CIP19_ENTERPRISE_ADDRESS), value: { coins: BigInt(2_000_000) } }],
            fee: BigInt(170_000),
            ...(requiredSigners.length ? { requiredExtraSignatures: requiredSigners } : {})
        },
        witness: { signatures: new Map() },
        isValid: true
    } as unknown as Cardano.Tx).toCbor() as string;

const inputOwnedBy = (address: string): Route => (url) =>
    url.includes('/txs/') && url.endsWith('/utxos') ? { status: 200, body: { outputs: [{ address, output_index: 0 }] } } : undefined;

describe('createLiveWallet', () => {
    it('derives the CIP-19 reference payment key and a base address bound to its own stake key', async () => {
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(() => undefined) });
        expect(wallet.paymentKeyHash).toBe(CIP19_PAYMENT_KEY_HASH);
        expect(Cardano.Address.fromBech32(CIP19_ENTERPRISE_ADDRESS).asEnterprise()!.getPaymentCredential().hash).toBe(wallet.paymentKeyHash);
        const base = Cardano.Address.fromBech32(wallet.address).asBase()!;
        expect(base.getPaymentCredential().hash).toBe(CIP19_PAYMENT_KEY_HASH);
        expect(base.getStakeCredential().hash).toBe(wallet.stakeKeyHash);
        expect(Cardano.Address.fromBech32(wallet.rewardAddress).asReward()!.getPaymentCredential().hash).toBe(wallet.stakeKeyHash);
        expect(wallet.stakeKeyHash).not.toBe(wallet.paymentKeyHash);
        expect(wallet.networkId).toBe(0);
        expect(await wallet.call('getChangeAddress')).toBe(Cardano.Address.fromBech32(wallet.address).toBytes());
    });

    it('derives a different, isolated wallet for another account index', async () => {
        const other = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', accountIndex: 1, fetchFn: fakeFetch(() => undefined) });
        expect(other.paymentKeyHash).not.toBe(CIP19_PAYMENT_KEY_HASH);
        expect(other.address.startsWith('addr_test1q')).toBe(true);
    });

    it('returns the full paginated UTxO set from base and enterprise-stake addresses', async () => {
        const probe = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(() => undefined) });
        const baseAddress = probe.address;
        const firstPage = Array.from({ length: 100 }, (_, i) => utxo('b'.repeat(64), i, 1_000_000 + i));
        const calls: string[] = [];
        const route: Route = (url) => {
            if (url.includes(`${baseAddress}/utxos`) && url.includes('page=1')) return { status: 200, body: firstPage };
            if (url.includes(`${baseAddress}/utxos`) && url.includes('page=2')) return { status: 200, body: [utxo('c'.repeat(64), 0, 5_000_000)] };
            return undefined; // enterprise-stake address never used -> 404 -> empty
        };
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(route, calls) });
        const utxos = (await wallet.call('getUtxos')) as string[];
        expect(utxos).toHaveLength(101);
        const last = Serialization.TransactionUnspentOutput.fromCbor(utxos[100] as never).toCore();
        expect(last[0]).toEqual({ txId: 'c'.repeat(64), index: 0 });
        expect(last[1].value.coins).toBe(BigInt(5_000_000));
        expect(last[1].address).toBe(baseAddress);
        expect(calls.filter((c) => c.includes(baseAddress))).toHaveLength(2);
    });

    it('signs with only the payment key and the signature verifies over the tx body hash', async () => {
        const wallet = await createLiveWallet({
            mnemonic: MNEMONIC,
            network: 'preview',
            blockfrostApiKey: 'k',
            fetchFn: fakeFetch(inputOwnedBy(CIP19_ENTERPRISE_ADDRESS))
        });
        const tx = unsignedTx();
        const witnessSet = Serialization.TransactionWitnessSet.fromCbor((await wallet.call('signTx', tx)) as never).toCore();
        const signatures = [...(witnessSet.signatures ?? new Map()).entries()];
        expect(signatures).toHaveLength(1);
        const [pubKey, signature] = signatures[0];
        expect(Crypto.Ed25519PublicKey.fromHex(pubKey).hash().hex()).toBe(wallet.paymentKeyHash);
        const bodyHash = txHashFromCbor(tx);
        expect(await Crypto.Ed25519PublicKey.fromHex(pubKey).verify(Crypto.Ed25519Signature.fromHex(signature), bodyHash as never)).toBe(true);
        // and the app-side merge yields a tx the ledger parser accepts with the same id
        const signed = mergeWitnessSet(tx, (await wallet.call('signTx', tx)) as string);
        expect(txHashFromCbor(signed)).toBe(bodyHash);
    });

    it('adds the stake-key witness only when the stake key is a required signer', async () => {
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(inputOwnedBy(CIP19_ENTERPRISE_ADDRESS)) });
        const ws = Serialization.TransactionWitnessSet.fromCbor((await wallet.call('signTx', unsignedTx([wallet.stakeKeyHash]))) as never).toCore();
        const hashes = [...(ws.signatures ?? new Map()).keys()].map((k) => Crypto.Ed25519PublicKey.fromHex(k).hash().hex()).sort();
        expect(hashes).toEqual([wallet.paymentKeyHash, wallet.stakeKeyHash].sort());
    });

    it('refuses to sign a tx whose body map is not canonical', async () => {
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(inputOwnedBy(CIP19_ENTERPRISE_ADDRESS)) });
        const tx = unsignedTx();
        const feeEntry = '021a00029810';
        const reordered = tx.replace(/^84a3/, `84a3${feeEntry}`).replace(new RegExp(`(${feeEntry}.*)${feeEntry}`), '$1');
        expect(reordered).not.toBe(tx);
        await expect(wallet.call('signTx', reordered)).rejects.toThrow('CBOR is not canonical');
    });

    it('submits to Blockfrost, retries transient errors, and surfaces permanent rejections', async () => {
        let attempts = 0;
        const flaky: Route = (url) => (url.endsWith('/tx/submit') ? (++attempts === 1 ? { status: 503, body: 'busy' } : { status: 200, body: '"abc123"' }) : undefined);
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(flaky) });
        await expect(wallet.call('submitTx', unsignedTx())).resolves.toBe('abc123');
        expect(attempts).toBe(2);
        expect(wallet.submittedTxHashes).toEqual(['abc123']);

        const rejecting = await createLiveWallet({
            mnemonic: MNEMONIC,
            network: 'preview',
            blockfrostApiKey: 'k',
            fetchFn: fakeFetch((url) => (url.endsWith('/tx/submit') ? { status: 400, body: 'BadInputsUTxO' } : undefined))
        });
        await expect(rejecting.call('submitTx', unsignedTx())).rejects.toThrow('Submit failed: 400 BadInputsUTxO');
        expect(rejecting.submittedTxHashes).toEqual([]);
    });

    it('reports no designated collateral and rejects unknown methods', async () => {
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'mainnet', blockfrostApiKey: 'k', fetchFn: fakeFetch(() => undefined) });
        expect(wallet.address.startsWith('addr1')).toBe(true);
        expect(await wallet.call('getCollateral')).toBeNull();
        await expect(wallet.call('stealKeys')).rejects.toThrow('Unknown CIP-30 method');
    });
});

describe('makeReadOnlyWallet', () => {
    it('blocks fund-moving methods, records the tx, and passes reads through', async () => {
        const inner = await createLiveWallet({ mnemonic: MNEMONIC, network: 'mainnet', blockfrostApiKey: 'k', fetchFn: fakeFetch(() => undefined) });
        const guard = makeReadOnlyWallet(inner);
        expect(await guard.wallet.call('getNetworkId')).toBe(1);
        expect(guard.reachedSign()).toBe(false);
        await expect(guard.wallet.call('signTx', 'deadbeef')).rejects.toThrow('E2E_READONLY_GUARD');
        await expect(guard.wallet.call('submitTx', 'cafe')).rejects.toThrow('E2E_READONLY_GUARD');
        expect(guard.signRequests.map((r) => [r.method, r.txCbor])).toEqual([
            ['signTx', 'deadbeef'],
            ['submitTx', 'cafe']
        ]);
        guard.reset();
        expect(guard.reachedSign()).toBe(false);
    });
});

describe('installLiveCip30Wallet', () => {
    it('exposes a CIP-30 wallet whose calls round-trip through the Node bridge', async () => {
        const calls: string[] = [];
        const wallet = { call: async (method: string, params: unknown) => (calls.push(`${method}:${JSON.stringify(params)}`), method === 'getNetworkId' ? 0 : ['u1']) } as unknown as LiveWallet;
        const bridge = createBridgeHandler(wallet);
        const window: Record<string, unknown> = { __liveCip30Call: bridge };
        vm.runInNewContext(buildCip30InitScript({ walletKey: 'hal', walletName: 'HAL E2E' }), { window });
        const entry = (window.cardano as Record<string, { name: string; enable: () => Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> }>).hal;
        expect(entry.name).toBe('HAL E2E');
        const api = await entry.enable();
        expect(await api.getNetworkId()).toBe(0);
        expect(await api.getUtxos()).toEqual(['u1']);
        await api.signTx('abcd');
        expect(calls).toEqual(['getNetworkId:null', 'getUtxos:null', 'signTx:"abcd"']);
    });

    it('registers the bridge on the browser context and tolerates a reused context', async () => {
        const exposed: string[] = [];
        const scripts: string[] = [];
        const page = {
            context: () => ({
                exposeFunction: async (name: string) => {
                    if (exposed.includes(name)) throw new Error(`Function "${name}" has been already registered`);
                    exposed.push(name);
                }
            }),
            addInitScript: async ({ content }: { content: string }) => void scripts.push(content)
        };
        const wallet = {} as LiveWallet;
        await installLiveCip30Wallet(page, wallet);
        await installLiveCip30Wallet(page, wallet);
        expect(exposed).toEqual(['__liveCip30Call']);
        expect(scripts).toHaveLength(2);

        const broken = { ...page, context: () => ({ exposeFunction: async () => Promise.reject(new Error('Target closed')) }) };
        await expect(installLiveCip30Wallet(broken, wallet)).rejects.toThrow('Target closed');
    });
});

describe('on-chain assertions', () => {
    const chain = (route: Route) => ({ network: 'preview' as const, blockfrostApiKey: 'k', fetchFn: fakeFetch(route) });
    const POLICY = 'ab'.repeat(28);

    it('assertAdaTransfer sums outputs to the address and rejects an underpayment', async () => {
        const route: Route = (url) =>
            url.endsWith('/txs/t1/utxos')
                ? {
                      status: 200,
                      body: {
                          outputs: [
                              { address: 'addr_a', output_index: 0, amount: [{ unit: 'lovelace', quantity: '20000000' }] },
                              { address: 'addr_a', output_index: 1, amount: [{ unit: 'lovelace', quantity: '10000000' }] },
                              { address: 'addr_b', output_index: 2, amount: [{ unit: 'lovelace', quantity: '99000000' }] }
                          ]
                      }
                  }
                : undefined;
        await expect(assertAdaTransfer(chain(route), 't1', 'addr_a', BigInt(30_000_000))).resolves.toBe(BigInt(30_000_000));
        await expect(assertAdaTransfer(chain(route), 't1', 'addr_a', BigInt(30_000_001))).rejects.toThrow('expected >= 30000001');
    });

    it('assertCip68Label requires the label and forbids the other', async () => {
        const unit222 = `${POLICY}${LBL_222}${hexOf('hal')}`;
        const unit100 = `${POLICY}${LBL_100}${hexOf('hal')}`;
        const present: Route = (url) => (url.endsWith(unit222) ? { status: 200, body: { quantity: '1' } } : undefined);
        await expect(assertCip68Label(chain(present), POLICY, 'hal', { hasLabel: LBL_222, notLabel: LBL_100 })).resolves.toBeUndefined();
        const both: Route = (url) => (url.endsWith(unit222) || url.endsWith(unit100) ? { status: 200, body: { quantity: '1' } } : undefined);
        await expect(assertCip68Label(chain(both), POLICY, 'hal', { hasLabel: LBL_222, notLabel: LBL_100 })).rejects.toThrow('must NOT exist');
        await expect(assertCip68Label(chain(() => undefined), POLICY, 'hal', { hasLabel: LBL_222 })).rejects.toThrow('expected asset');
    });

    it('waitForTxConfirmation reports a phase-2 failure instead of treating it as success', async () => {
        let polls = 0;
        const route: Route = (url) => (url.endsWith('/txs/t2') ? (++polls < 2 ? undefined : { status: 200, body: { block: 'b1', valid_contract: false } }) : undefined);
        await expect(waitForTxConfirmation(chain(route), 't2', 1000, 1)).resolves.toEqual({ confirmed: true, block: 'b1', validContract: false });
        await expect(waitForTxConfirmation(chain(() => undefined), 'never', 5, 1)).resolves.toEqual({ confirmed: false });
    });
});
