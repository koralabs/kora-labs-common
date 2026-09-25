import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import vm from 'node:vm';
import { resetRateLimits } from '../chain/transport/rateLimit';
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

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> } | undefined;

const fakeFetch = (route: Route, calls: string[] = []) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        const hit = route(url, init) ?? { status: 404, body: { status_code: 404, error: 'Not Found', message: 'The requested component has not been found.' } };
        return new Response(typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body), { status: hit.status, headers: hit.headers });
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
        const txId = txHashFromCbor(unsignedTx());
        const flaky: Route = (url) => (url.endsWith('/tx/submit') ? (++attempts === 1 ? { status: 503, body: 'busy' } : { status: 200, body: `"${txId}"` }) : undefined);
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(flaky) });
        await expect(wallet.call('submitTx', unsignedTx())).resolves.toBe(txId);
        expect(attempts).toBe(2);
        expect(wallet.submittedTxHashes).toEqual([txId]);

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

/**
 * In-memory Blockfrost: address UTxO sets, which txs are in a block, and a submit endpoint that answers
 * with the real tx id. Txs this wallet submits exist on it only once the test "lands" them.
 */
const fakeChain = () => {
    const utxosByAddress = new Map<string, ReturnType<typeof utxo>[]>();
    const inBlock = new Set<string>();
    const calls: string[] = [];
    const route: Route = (url, init) => {
        if (url.endsWith('/tx/submit')) return { status: 200, body: `"${txHashFromCbor(Buffer.from(init!.body as Uint8Array).toString('hex'))}"` };
        const addr = url.match(/\/addresses\/([^/]+)\/utxos\?/)?.[1];
        if (addr) return utxosByAddress.get(addr)?.length ? { status: 200, body: utxosByAddress.get(addr) } : undefined;
        const tx = url.match(/\/txs\/([0-9a-f]{64})$/)?.[1];
        if (tx && inBlock.has(tx)) return { status: 200, body: { hash: tx, block: 'b'.repeat(64), valid_contract: true } };
        return undefined;
    };
    const set = (address: string, ...entries: ReturnType<typeof utxo>[]) => utxosByAddress.set(address, entries);
    return { set, inBlock, calls, fetchFn: fakeFetch(route, calls) };
};

const OTHER = CIP19_ENTERPRISE_ADDRESS;
const payTx = (inputs: string[], outputs: [string, number][]) =>
    Serialization.Transaction.fromCore({
        id: '0'.repeat(64),
        body: {
            inputs: inputs.map((ref) => ({ txId: ref.split('#')[0], index: Number(ref.split('#')[1]) })),
            outputs: outputs.map(([address, coins]) => ({ address: Cardano.PaymentAddress(address), value: { coins: BigInt(coins) } })),
            fee: BigInt(170_000)
        },
        witness: { signatures: new Map() },
        isValid: true
    } as unknown as Cardano.Tx).toCbor() as string;

const refsOf = (cbors: string[]) =>
    cbors
        .map((c) => Serialization.TransactionUnspentOutput.fromCbor(c as never).toCore())
        .map(([input, output]) => `${input.txId}#${input.index}=${output.value.coins}`)
        .sort();

const witnessKeyHashes = (witnessSetCbor: string) =>
    [...(Serialization.TransactionWitnessSet.fromCbor(witnessSetCbor as never).toCore().signatures ?? new Map()).keys()]
        .map((k) => Crypto.Ed25519PublicKey.fromHex(k).hash().hex())
        .sort();

describe('createLiveWallet chains like a real wallet', () => {
    const A = 'a1'.repeat(32);
    const B = 'b2'.repeat(32);
    afterEach(() => resetRateLimits());

    it('hands out its own unconfirmed change and hides the inputs it spent, until the tx is in a block', async () => {
        const chain = fakeChain();
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: chain.fetchFn });
        chain.set(wallet.address, utxo(A, 0, 10_000_000), utxo(B, 0, 3_000_000));

        const t1Cbor = payTx([`${A}#0`], [[OTHER, 2_000_000], [wallet.address, 7_830_000]]);
        const t1 = (await wallet.call('submitTx', t1Cbor)) as string;
        expect(t1).toBe(txHashFromCbor(t1Cbor));
        // Blockfrost still reports A unspent and knows nothing of t1 — the wallet does.
        expect(refsOf((await wallet.call('getUtxos')) as string[])).toEqual([`${B}#0=3000000`, `${t1}#1=7830000`].sort());
        expect(Serialization.Value.fromCbor((await wallet.call('getBalance')) as never).toCore().coins).toBe(BigInt(10_830_000));

        // A second tx built from t1's unconfirmed change is a chained submission.
        const t2 = (await wallet.call('submitTx', payTx([`${t1}#1`], [[OTHER, 2_000_000], [wallet.address, 5_660_000]]))) as string;
        expect(wallet.submissions.map((s) => [s.txHash, s.chainedInputs])).toEqual([
            [t1, []],
            [t2, [`${t1}#1`]]
        ]);
        expect(refsOf((await wallet.call('getUtxos')) as string[])).toEqual([`${B}#0=3000000`, `${t2}#1=5660000`].sort());
        expect(wallet.pendingTxHashes()).toEqual([t1, t2]);

        // t1 lands: its change is on chain but still spent by pending t2.
        chain.inBlock.add(t1);
        chain.set(wallet.address, utxo(B, 0, 3_000_000), utxo(t1, 1, 7_830_000));
        expect(refsOf((await wallet.call('getUtxos')) as string[])).toEqual([`${B}#0=3000000`, `${t2}#1=5660000`].sort());
        expect(wallet.pendingTxHashes()).toEqual([t2]);

        // t2 lands: chain truth takes over — an output later gone from chain is not resurrected.
        chain.inBlock.add(t2);
        chain.set(wallet.address, utxo(B, 0, 3_000_000));
        expect(refsOf((await wallet.call('getUtxos')) as string[])).toEqual([`${B}#0=3000000`]);
        expect(wallet.pendingTxHashes()).toEqual([]);
        expect(await wallet.countUtxos()).toBe(1);
        // The wallet never asked a provider about its own chained inputs.
        expect(chain.calls.filter((c) => /\/txs\/[0-9a-f]+\/utxos/.test(c))).toEqual([]);
    });

    it('only its own outputs join the view, and a rejected submission changes nothing', async () => {
        const chain = fakeChain();
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: chain.fetchFn });
        chain.set(wallet.address, utxo(A, 0, 10_000_000));
        const t1 = (await wallet.call('submitTx', payTx([`${A}#0`], [[OTHER, 9_830_000]]))) as string;
        expect(await wallet.call('getUtxos')).toEqual([]);
        expect(wallet.pendingTxHashes()).toEqual([t1]);

        const rejecting = await createLiveWallet({
            mnemonic: MNEMONIC,
            network: 'preview',
            blockfrostApiKey: 'k',
            fetchFn: fakeFetch((url) =>
                url.endsWith('/tx/submit')
                    ? { status: 400, body: { status_code: 400, error: 'Bad Request', message: 'BadInputsUTxO' } }
                    : url.includes(`${wallet.address}/utxos`)
                      ? { status: 200, body: [utxo(A, 0, 10_000_000)] }
                      : undefined
            )
        });
        await expect(rejecting.call('submitTx', payTx([`${A}#0`], [[OTHER, 9_830_000]]))).rejects.toThrow('Submit failed: 400 BadInputsUTxO');
        expect(refsOf((await rejecting.call('getUtxos')) as string[])).toEqual([`${A}#0=10000000`]);
        expect(rejecting.submissions).toEqual([]);
    });

    it('signs a chained input at its stake-key address with the stake key, resolved from its own view', async () => {
        const chain = fakeChain();
        const wallet = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: chain.fetchFn });
        const stakeKeyAddress = Cardano.EnterpriseAddress.fromCredentials(0, { type: Cardano.CredentialType.KeyHash, hash: wallet.stakeKeyHash as never })
            .toAddress()
            .toBech32();
        chain.set(wallet.address, utxo(A, 0, 10_000_000));
        const t1 = (await wallet.call('submitTx', payTx([`${A}#0`], [[stakeKeyAddress, 5_000_000], [wallet.address, 4_830_000]]))) as string;
        expect(refsOf((await wallet.call('getUtxos')) as string[])).toEqual([`${t1}#0=5000000`, `${t1}#1=4830000`].sort());

        const spendsStakeOutput = (await wallet.call('signTx', payTx([`${t1}#0`], [[OTHER, 4_800_000]]))) as string;
        expect(witnessKeyHashes(spendsStakeOutput)).toEqual([wallet.paymentKeyHash, wallet.stakeKeyHash].sort());
        const spendsBaseOutput = (await wallet.call('signTx', payTx([`${t1}#1`], [[OTHER, 4_800_000]]))) as string;
        expect(witnessKeyHashes(spendsBaseOutput)).toEqual([wallet.paymentKeyHash]);
        expect(chain.calls.filter((c) => /\/txs\/[0-9a-f]+\/utxos/.test(c))).toEqual([]);
    });

    it('waits out a stated rate limit before calling Blockfrost again, and stops when none is stated', async () => {
        const probe = await createLiveWallet({ mnemonic: MNEMONIC, network: 'preview', blockfrostApiKey: 'k', fetchFn: fakeFetch(() => undefined) });
        const at: number[] = [];
        const limited = await createLiveWallet({
            mnemonic: MNEMONIC,
            network: 'preview',
            blockfrostApiKey: 'k',
            fetchFn: fakeFetch((url) => {
                if (!url.includes(`${probe.address}/utxos`)) return undefined;
                at.push(Date.now());
                return at.length === 1
                    ? { status: 429, body: { status_code: 429, error: 'Project Over Limit', message: 'slow down' }, headers: { 'Retry-After': '1' } }
                    : { status: 200, body: [utxo(A, 0, 10_000_000)] };
            })
        });
        expect(refsOf((await limited.call('getUtxos')) as string[])).toEqual([`${A}#0=10000000`]);
        expect(at).toHaveLength(2);
        expect(at[1] - at[0]).toBeGreaterThanOrEqual(1000);

        resetRateLimits();
        let attempts = 0;
        const unstated = await createLiveWallet({
            mnemonic: MNEMONIC,
            network: 'preview',
            blockfrostApiKey: 'k',
            fetchFn: fakeFetch((url) => (url.includes('/utxos') ? (attempts++, { status: 429, body: { status_code: 429, error: 'Project Over Limit', message: 'slow down' } }) : undefined))
        });
        await expect(unstated.call('getUtxos')).rejects.toThrow('429');
        expect(attempts).toBe(1);
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
        await expect(guard.wallet.call('signTxs', [{ cbor: 'aa', partialSign: true }, 'bb'])).rejects.toThrow('E2E_READONLY_GUARD');
        expect(guard.signRequests[2].txCbors).toEqual(['aa', 'bb']);
        expect(guard.signRequests[2].txCbor).toBe('aa');
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
        const route: Route = (url) =>
            url.endsWith('/txs/t2') ? (++polls < 2 ? undefined : { status: 200, body: { block: 'b1', valid_contract: false } }) : url.endsWith('/txs/t2/utxos') ? { status: 200, body: { outputs: [] } } : undefined;
        await expect(waitForTxConfirmation(chain(route), 't2', 1000, 1)).resolves.toEqual({ confirmed: true, block: 'b1', validContract: false });
        await expect(waitForTxConfirmation(chain(() => undefined), 'never', 5, 1)).resolves.toEqual({ confirmed: false });
    });

    it('waitForTxConfirmation reports confirmed only once Blockfrost also serves the tx UTxOs', async () => {
        // Seen live: /txs/<hash> answered while /txs/<hash>/utxos still 404'd, and the next read failed.
        let utxoPolls = 0;
        const route: Route = (url) => {
            if (url.endsWith('/txs/t3')) return { status: 200, body: { block: 'b3', valid_contract: true } };
            if (url.endsWith('/txs/t3/utxos')) return ++utxoPolls < 3 ? undefined : { status: 200, body: { outputs: [] } };
            return undefined;
        };
        await expect(waitForTxConfirmation(chain(route), 't3', 1000, 1)).resolves.toEqual({ confirmed: true, block: 'b3', validContract: true });
        expect(utxoPolls).toBe(3);
        const neverReadable: Route = (url) => (url.endsWith('/txs/t4') ? { status: 200, body: { block: 'b4', valid_contract: true } } : undefined);
        await expect(waitForTxConfirmation(chain(neverReadable), 't4', 20, 1)).resolves.toEqual({ confirmed: false });
    });
});
