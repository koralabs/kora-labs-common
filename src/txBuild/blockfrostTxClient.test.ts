import { Cardano, Serialization } from '@cardano-sdk/core';
import { resetRateLimits } from '../chain/transport/rateLimit';
import { BlockfrostTxClient, protocolParametersFromChain, valueFromBlockfrost } from './blockfrost';

const POLICY = 'ab'.repeat(28);
const ADDR = 'addr_test1wz3ctt45cvuqkljqpv2wqy2zkdgwq8qa6xakmzz6f2xv0pgqr6lh0';
const TX = '9'.repeat(64);
const SCRIPT_CBOR = '4e4d01000033222220051200120011'; // any CBOR byte string; its hash is computed, not assumed
const scriptHash = (version: Cardano.PlutusLanguageVersion) =>
    Serialization.Script.fromCore({ __type: Cardano.ScriptType.Plutus, version, bytes: SCRIPT_CBOR as never }).hash();

const respond = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: 'st', text: async () => JSON.stringify(body), headers: { get: () => null } });

/** A client whose fetcher serves `routes` (first path-suffix match) and records every call. */
const clientWith = (routes: Record<string, { status?: number; body: unknown }>) => {
    const calls: { url: string; init?: any }[] = [];
    const client = new BlockfrostTxClient({
        network: 'Preview',
        blockfrostApiKey: 'key',
        fetcher: async (url, init) => {
            calls.push({ url, init });
            const route = Object.keys(routes).find((r) => url.includes(r));
            const hit = route ? routes[route] : { status: 404, body: { status_code: 404, message: 'nf' } };
            return respond(hit.status ?? 200, hit.body);
        }
    });
    return { client, calls };
};

afterEach(() => resetRateLimits());

describe('Blockfrost value and protocol parameter conversion', () => {
    it('valueFromBlockfrost splits lovelace from native assets and omits an empty asset map', () => {
        expect(valueFromBlockfrost([{ unit: 'lovelace', quantity: '7' }])).toEqual({ coins: BigInt(7) });
        const v = valueFromBlockfrost([{ unit: 'lovelace', quantity: '7' }, { unit: `${POLICY}6162`, quantity: '3' }]);
        expect(v.coins).toBe(BigInt(7));
        expect(v.assets?.get(Cardano.AssetId(`${POLICY}6162`))).toBe(BigInt(3));
    });

    it('protocolParametersFromChain keeps only known Plutus languages and rejects params without cost_models_raw', () => {
        const base: any = {
            epoch: 1, min_fee_a: 44, min_fee_b: 155381, max_tx_size: 16384, coins_per_utxo_size: '4310', key_deposit: '2000000',
            price_mem: 0.0577, price_step: 0.0000721, max_tx_ex_mem: '14000000', max_tx_ex_steps: '10000000000'
        };
        expect(() => protocolParametersFromChain(base)).toThrow(/cost_models_raw/);
        const p = protocolParametersFromChain({ ...base, cost_models_raw: { PlutusV1: [1], PlutusV3: [3], Bogus: [9] } });
        expect([...p.costModels.keys()].sort()).toEqual([Cardano.PlutusLanguageVersion.V1, Cardano.PlutusLanguageVersion.V3].sort());
        expect(p.minFeeA).toBe(BigInt(44));
        expect(p.coinsPerUtxoByte).toBe(BigInt(4310));
        expect(p.maxTxExUnits).toEqual({ memory: 14000000, steps: 10000000000 });
        expect(p.minFeeRefScriptCostPerByte).toEqual({ n: BigInt(0), d: BigInt(1) });
    });
});

describe('BlockfrostTxClient reads', () => {
    it('hits the lower-cased network host with the project id, and slotAt counts one-second slots from the tip', async () => {
        const { client, calls } = clientWith({ 'blocks/latest': { body: { slot: 1000, time: 5000, hash: 'h', height: 1 } } });
        expect(await client.slotAt(5_000_000 + 7_900)).toBe(1007);
        expect(await client.slotAt(5_000_000 - 2_000)).toBe(998);
        expect(calls[0].url).toBe('https://cardano-preview.blockfrost.io/api/v0/blocks/latest');
        expect(calls[0].init.headers.project_id).toBe('key');
    });

    it('getScript resolves native and Plutus scripts, caches by hash, and verifies the CBOR hashes to the requested hash', async () => {
        const v2 = scriptHash(Cardano.PlutusLanguageVersion.V2);
        const { client, calls } = clientWith({
            [`scripts/${v2}/cbor`]: { body: { cbor: SCRIPT_CBOR } },
            [`scripts/${v2}`]: { body: { type: 'plutusV2', serialised_size: 15 } },
            'scripts/native1': { body: { type: 'timelock', serialised_size: null } },
            'scripts/weird': { body: { type: 'plutusV9', serialised_size: 1 } },
            'scripts/forged/cbor': { body: { cbor: SCRIPT_CBOR } },
            'scripts/forged': { body: { type: 'plutusV2', serialised_size: 1 } }
        });
        const s = await client.getScript(v2);
        expect(s).toMatchObject({ hash: v2, language: Cardano.PlutusLanguageVersion.V2, size: 15 });
        expect(s.script).toBeDefined();
        await client.getScript(v2);
        expect(calls.filter((c) => c.url.endsWith(`scripts/${v2}`))).toHaveLength(1);

        expect(await client.getScript('native1')).toEqual({ hash: 'native1', language: 'native', size: 0 });
        await expect(client.getScript('weird')).rejects.toThrow(/Unknown script type plutusV9/);
        // a CBOR that does not hash to the requested hash is refused, and the failure is not cached
        await expect(client.getScript('forged')).rejects.toThrow(/does not hash/);
        await expect(client.getScript('forged')).rejects.toThrow(/does not hash/);
        expect(calls.filter((c) => c.url.endsWith('scripts/forged'))).toHaveLength(2);
    });

    it('getAddressUtxos pages full pages, decodes datums/reference scripts, and treats a never-funded address as empty', async () => {
        const v2 = scriptHash(Cardano.PlutusLanguageVersion.V2);
        const full = Array.from({ length: 100 }, (_, i) => ({ tx_hash: TX, output_index: i, amount: [{ unit: 'lovelace', quantity: '1' }] }));
        const last = [
            { tx_hash: TX, output_index: 100, amount: [{ unit: 'lovelace', quantity: '2' }], inline_datum: 'd87980' },
            { tx_hash: TX, output_index: 101, amount: [{ unit: 'lovelace', quantity: '3' }], data_hash: 'cd'.repeat(32), inline_datum: null },
            { tx_hash: TX, output_index: 102, amount: [{ unit: 'lovelace', quantity: '4' }], reference_script_hash: v2 }
        ];
        const { client } = clientWith({
            'page=1&': { body: full },
            'page=2&': { body: last },
            [`scripts/${v2}/cbor`]: { body: { cbor: SCRIPT_CBOR } },
            [`scripts/${v2}`]: { body: { type: 'plutusV2', serialised_size: 15 } }
        });
        const utxos = await client.getAddressUtxos(ADDR);
        expect(utxos).toHaveLength(103);
        const [datumUtxo, hashUtxo, refUtxo] = utxos.slice(100).map(([, out]) => out);
        expect(datumUtxo.datum).toBeDefined();
        expect(datumUtxo.datumHash).toBeUndefined();
        expect(hashUtxo.datumHash).toBe('cd'.repeat(32));
        expect(hashUtxo.datum).toBeUndefined();
        expect(refUtxo.scriptReference).toBeDefined();
        expect(utxos[0][0]).toMatchObject({ txId: TX, index: 0, address: ADDR });

        expect(await clientWith({}).client.getAddressUtxos(ADDR)).toEqual([]);
    });

    it('getAddressAssetUtxos returns the UTxOs holding a unit, or none for an unknown unit', async () => {
        const unit = `${POLICY}6162`;
        const { client } = clientWith({ [`utxos/${unit}`]: { body: [{ tx_hash: TX, output_index: 3, amount: [{ unit: 'lovelace', quantity: '2' }, { unit, quantity: '1' }] }] } });
        const got = await client.getAddressAssetUtxos(ADDR, unit);
        expect(got).toHaveLength(1);
        expect(got[0][1].value.assets?.get(Cardano.AssetId(unit))).toBe(BigInt(1));
        expect(await client.getAddressAssetUtxos(ADDR, `${POLICY}ff`)).toEqual([]);
    });

    it('getUtxo returns an unspent output and refuses a missing index', async () => {
        const { client } = clientWith({ [`txs/${TX}/utxos`]: { body: { outputs: [{ address: ADDR, output_index: 0, amount: [{ unit: 'lovelace', quantity: '5' }] }] } } });
        const [ref, out] = await client.getUtxo(`${TX}#0`);
        expect(ref.index).toBe(0);
        expect(out.value.coins).toBe(BigInt(5));
        await expect(client.getUtxo(`${TX}#4`)).rejects.toThrow(/does not exist/);
    });

    it('a non-404 failure on a read is rethrown, not swallowed as empty', async () => {
        const { client } = clientWith({ '/': { status: 403, body: { status_code: 403, message: 'forbidden' } } });
        await expect(client.getAddressUtxos(ADDR)).rejects.toMatchObject({ status: 403 });
        await expect(client.getAccount('stake1')).rejects.toBeDefined();
    });
});

describe('BlockfrostTxClient writes', () => {
    it('evaluateTx normalizes ogmios purposes (withdraw/reward -> withdrawal), keeps unknown ones, and surfaces a fault', async () => {
        const result = { EvaluationResult: { 'withdraw:0': { memory: 1, steps: 2 }, 'reward:1': { memory: 3, steps: 4 }, 'vote:2': { memory: 5, steps: 6 } } };
        const { client, calls } = clientWith({ 'utils/txs/evaluate/utxos': { body: { result } } });
        const units = await client.evaluateTx('84a0');
        expect([...units.keys()].sort()).toEqual(['vote:2', 'withdrawal:0', 'withdrawal:1']);
        expect(JSON.parse(calls[0].init.body)).toEqual({ cbor: '84a0', additionalUtxoSet: [] });
        expect(calls[0].init.method).toBe('POST');

        const faulty = clientWith({ 'utils/txs/evaluate/utxos': { body: { fault: { string: 'boom' } } } }).client;
        await expect(faulty.evaluateTx('84a0')).rejects.toThrow(/boom/);
    });

    it('submitTx posts the raw CBOR bytes once (no blind retry on a 5xx) and returns the tx hash', async () => {
        const ok = clientWith({ 'tx/submit': { body: TX } });
        expect(await ok.client.submitTx('84a1')).toBe(TX);
        expect(ok.calls[0].init.method).toBe('POST');
        expect(ok.calls[0].init.headers['Content-Type']).toBe('application/cbor');
        expect(Buffer.from(ok.calls[0].init.body).toString('hex')).toBe('84a1');

        const down = clientWith({ 'tx/submit': { status: 500, body: { message: 'node down' } } });
        await expect(down.client.submitTx('84a1')).rejects.toBeDefined();
        expect(down.calls).toHaveLength(1);
    });
});
