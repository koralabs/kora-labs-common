import { Cardano, Serialization, setInConwayEra } from '@cardano-sdk/core';
import { locateTxBody } from '../tx';
import { resetRateLimits } from '../chain/transport/rateLimit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('./fixtures/previewHalMintTx.json');
import { BlockfrostEvaluationError, BlockfrostTxClient, toOgmiosUtxo } from './blockfrost';
import { minFee, ratio, referenceScriptFee, scriptExecutionFee } from './fees';
import { applyParamsToScript, localEvaluator, plutusScriptHash, toDoubleCbor, toSingleCbor } from './scalus';
import { addVkeyWitnesses, certificateDeposit, selectWalletInputs, computeScriptDataHash, Evaluator, finalizeScriptTx, ScriptTxProtocolParameters, withMinAda } from './scriptTx';

setInConwayEra(true);

const liveTx = Serialization.Transaction.fromCbor(fixture.cbor as Serialization.TxCBOR);
const params: ScriptTxProtocolParameters = {
    minFeeA: BigInt(fixture.params.min_fee_a),
    minFeeB: BigInt(fixture.params.min_fee_b),
    priceMemory: ratio(fixture.params.price_mem),
    priceSteps: ratio(fixture.params.price_step),
    minFeeRefScriptCostPerByte: ratio(fixture.params.min_fee_ref_script_cost_per_byte),
    coinsPerUtxoByte: BigInt(fixture.params.coins_per_utxo_size),
    stakeKeyDeposit: BigInt(fixture.params.key_deposit),
    maxTxSize: fixture.params.max_tx_size,
    maxTxExUnits: { memory: Number(fixture.params.max_tx_ex_mem), steps: Number(fixture.params.max_tx_ex_steps) },
    costModels: new Map([[Cardano.PlutusLanguageVersion.V2, fixture.params.cost_models_raw.PlutusV2]])
};

describe('fees', () => {
    it('parses provider decimals into exact ratios', () => {
        expect(ratio(0.0577)).toEqual({ n: BigInt(577), d: BigInt(10000) });
        expect(ratio('0.0000721')).toEqual({ n: BigInt(721), d: BigInt(10000000) });
        expect(ratio(7.21e-5)).toEqual({ n: BigInt(721), d: BigInt(10000000) });
        expect(() => ratio('-1')).toThrow();
    });

    it('prices the ex-unit TOTAL and rounds once (ceiling)', () => {
        // 0.0577 * 3 + 0.0000721 * 0 = 0.1731 -> 1 (per-redeemer rounding would give 3)
        expect(scriptExecutionFee(params, [{ memory: 1, steps: 0 }, { memory: 1, steps: 0 }, { memory: 1, steps: 0 }])).toBe(BigInt(1));
    });

    it('tiers the reference-script fee every 25,600 bytes (x1.2) and floors', () => {
        const fifteen = ratio(15);
        expect(referenceScriptFee(fifteen, 25_599)).toBe(BigInt(383_985));
        expect(referenceScriptFee(fifteen, 25_600)).toBe(BigInt(384_000));
        // 25,600 * 15 + 2,106 * 18
        expect(referenceScriptFee(fifteen, 27_706)).toBe(BigInt(384_000 + 37_908));
    });

    it('the chain accepted the live Helios mint at a fee at or above our ledger minimum for it', () => {
        const exUnits = liveTx.witnessSet().redeemers()!.values().map((r) => r.exUnits().toCore());
        const ourMin = minFee(params, fixture.cbor.length / 2, exUnits, fixture.referenceScriptBytes);
        expect(ourMin).toBeLessThanOrEqual(BigInt(fixture.fee));
        // Negative control: the same tx without the tiered ref-script fee would be ~420k lovelace short.
        expect(BigInt(fixture.fee) - ourMin).toBeLessThan(BigInt(1_000));
    });
});

describe('computeScriptDataHash', () => {
    it('reproduces the script_data_hash of a live preview Plutus tx from its shipped redeemer bytes', () => {
        const redeemersCbor = liveTx.witnessSet().redeemers()!.toCbor();
        const hash = computeScriptDataHash({ redeemersCbor, costModels: params.costModels, languages: [Cardano.PlutusLanguageVersion.V2] });
        expect(hash).toBe(liveTx.body().scriptDataHash());
    });

    it('changes when the cost model is out of ledger order (negative control for the cost_models_raw fix)', () => {
        const redeemersCbor = liveTx.witnessSet().redeemers()!.toCbor();
        const shuffled = new Map([[Cardano.PlutusLanguageVersion.V2, [...fixture.params.cost_models_raw.PlutusV2].reverse()]]);
        expect(computeScriptDataHash({ redeemersCbor, costModels: shuffled, languages: [Cardano.PlutusLanguageVersion.V2] })).not.toBe(liveTx.body().scriptDataHash());
    });

    it('is absent without redeemers or datums and fails loudly without a cost model', () => {
        expect(computeScriptDataHash({ costModels: params.costModels, languages: [] })).toBeUndefined();
        expect(() => computeScriptDataHash({ redeemersCbor: 'a0', costModels: new Map(), languages: [Cardano.PlutusLanguageVersion.V2] })).toThrow(/No cost model/);
    });
});

// ---- finalizeScriptTx: a synthetic spend + mint + withdrawal plan against a fake node evaluator ----
const SCRIPT_ADDR = 'addr_test1wq6p4p5ftpyq5wgrjn9vvwznkxn3sp7w5cwjq5ha94ag5lg2m5g0g';
const USER_ADDR = 'addr_test1qpzakwt3g5fx2cqe0t0vskglqzr574gn4w932j86a9tq3g6at82wpmdq5cucr2l28ml298g504rgfgh5e30te2p6v4ksaju0af';
const CHANGE_ADDR = 'addr_test1qzj6ks8jsrvg4evsfmyd7vyhfugpdzz5a7hafm8uu55qjt3t2eyg4xqdp6nzhg4j88qkl9fyvex4ewe2zwmhe645ksxquzyvpf';
const POLICY_B = 'b'.repeat(56);
const POLICY_A = 'a'.repeat(56);
const constr0 = () => Serialization.PlutusData.fromCbor('d87980' as never);
const utxo = (txId: string, index: number, coins: bigint, address = SCRIPT_ADDR): Cardano.Utxo => [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    { address: address as Cardano.PaymentAddress, value: { coins } }
];

const plan = () => ({
    // Deliberately unsorted: `f…` sorts after `1…`, so the script spend lands at index 1.
    inputs: [
        { utxo: utxo('f'.repeat(64), 0, BigInt(50_000_000)), redeemer: constr0() },
        { utxo: utxo('1'.repeat(64), 3, BigInt(10_000_000), CHANGE_ADDR) }
    ],
    referenceInputs: [{ txId: Cardano.TransactionId('e'.repeat(64)), index: 0 }, { txId: Cardano.TransactionId('2'.repeat(64)), index: 1 }],
    collateral: [{ txId: Cardano.TransactionId('3'.repeat(64)), index: 2 }],
    outputs: [{ address: USER_ADDR as Cardano.PaymentAddress, value: { coins: BigInt(1), assets: new Map([[Cardano.AssetId(`${POLICY_B}0102`), BigInt(1)]]) } }],
    mint: [
        { policyId: POLICY_B, assets: new Map([['0102', BigInt(1)]]), redeemer: constr0() },
        { policyId: POLICY_A, assets: new Map([['03', BigInt(1)]]) } // native policy: no redeemer, still takes a sorted slot
    ],
    withdrawals: [{ rewardAccount: 'stake_test17psgvdz3x5svrm0ryz7uqnswhzrh2ewjrhsw2gnnvvhglgcpj5pgv', quantity: BigInt(0), redeemer: constr0() }],
    requiredSigners: ['4da965a049dfd15ed1ee19fba6e2974a0b79fc416dd1796a1f97f5e1'],
    nativeScripts: [{ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireSignature, keyHash: 'c5cfaeb9668de45d688ce232e0a67b3dee3d4d12388232e4b74f3405' } as Cardano.NativeScript],
    validityInterval: { invalidBefore: Cardano.Slot(123_572_765) },
    changeAddress: CHANGE_ADDR,
    signerCount: 3,
    plutusLanguages: [Cardano.PlutusLanguageVersion.V2],
    referenceScriptBytes: 27_706
});

/** A node stand-in: prices each redeemer in the tx, charging more steps once the fee (part of the ScriptContext) is set. */
const COST: Record<string, { memory: number; steps: number }> = {
    spend: { memory: 4_528_451, steps: 1_393_984_914 },
    mint: { memory: 318_996, steps: 97_411_777 },
    withdrawal: { memory: 438_245, steps: 133_479_583 }
};
const fakeNode = (): { evaluate: Evaluator; seen: string[] } => {
    const seen: string[] = [];
    const evaluate: Evaluator = async (cbor) => {
        seen.push(cbor);
        const tx = Serialization.Transaction.fromCbor(cbor as Serialization.TxCBOR);
        const extra = tx.body().fee() > BigInt(0) ? 1_000 : 0;
        return new Map(
            tx.witnessSet().redeemers()!.toCore().map((r) => [`${r.purpose}:${r.index}`, { memory: COST[r.purpose].memory, steps: COST[r.purpose].steps + (r.purpose === 'spend' ? extra : 0) }])
        );
    };
    return { evaluate, seen };
};

describe('finalizeScriptTx', () => {
    it('builds a balanced tx at the exact ledger minimum fee with node-evaluated units on ledger-sorted pointers', async () => {
        const node = fakeNode();
        const built = await finalizeScriptTx(plan(), params, node.evaluate);
        const tx = Serialization.Transaction.fromCbor(built.cbor as Serialization.TxCBOR);
        const body = tx.body().toCore();

        // Pointers follow the ledger's canonical orderings, not insertion order.
        expect(body.inputs.map((i) => i.txId[0])).toEqual(['1', 'f']);
        expect(body.referenceInputs!.map((i) => i.txId[0])).toEqual(['2', 'e']);
        const redeemers = tx.witnessSet().redeemers()!.toCore();
        expect(redeemers.map((r) => `${r.purpose}:${r.index}`).sort()).toEqual(['mint:1', 'spend:1', 'withdrawal:0']);
        // Units are the node's for the tx as submitted (fee > 0), not the placeholder pass.
        expect(redeemers.find((r) => r.purpose === 'spend')!.executionUnits.steps).toBe(1_393_985_914);
        expect(node.seen.length).toBeGreaterThanOrEqual(2);

        // script_data_hash covers the redeemer bytes actually shipped.
        expect(tx.body().scriptDataHash()).toBe(
            computeScriptDataHash({ redeemersCbor: tx.witnessSet().redeemers()!.toCbor(), costModels: params.costModels, languages: [Cardano.PlutusLanguageVersion.V2] })
        );

        // Outputs below min-UTxO were raised to it; the change output is last and balances the tx.
        expect(built.outputs[0].value.coins).toBe(withMinAda(plan().outputs[0], params.coinsPerUtxoByte).value.coins);
        const change = built.outputs[built.outputs.length - 1];
        expect(change.address).toBe(CHANGE_ADDR);
        expect(change.value.assets?.get(Cardano.AssetId(`${POLICY_A}03`))).toBe(BigInt(1)); // minted, not paid out -> change
        expect(BigInt(60_000_000)).toBe(built.outputs.reduce((sum, o) => sum + o.value.coins, BigInt(0)) + built.fee);

        // Fee = ledger minimum for the SIGNED size (3 vkey witnesses), within the fee's own width.
        const signed = addVkeyWitnesses(built.cbor, [1, 2, 3].map((i) => ({ vkey: String(i).repeat(64), signature: 'ab'.repeat(64) })));
        const exUnits = redeemers.map((r) => r.executionUnits);
        expect(built.fee).toBe(minFee(params, signed.length / 2, exUnits, 27_706));
        expect(built.txId).toBe(tx.getId());
    });

    it('refuses a plan whose inputs cannot cover outputs + fee', async () => {
        const poor = { ...plan(), inputs: [{ utxo: utxo('f'.repeat(64), 0, BigInt(2_000_000)), redeemer: constr0() }] };
        await expect(finalizeScriptTx(poor, params, fakeNode().evaluate)).rejects.toThrow(/do not cover outputs \+ fee/);
    });

    it('refuses outputs that pay out tokens nobody provides', async () => {
        const stray = { ...plan(), mint: [] };
        await expect(finalizeScriptTx(stray, params, fakeNode().evaluate)).rejects.toThrow(/more .* than the inputs and mint provide/);
    });
});

describe('finalizeScriptTx with certificates', () => {
    // Invariant: a stake registration locks key_deposit, so the change is inputs − deposit − fee.
    // Failure caught: an unbalanced tx (ValueNotConservedUTxO) when registering a script's staking credential.
    // Negative control: leaving the deposit out of the balance makes Σoutputs + fee + deposit ≠ Σinputs.
    it('balances a stake registration deposit and never evaluates a script-free tx', async () => {
        let evaluations = 0;
        const registration: Cardano.Certificate = {
            __typename: Cardano.CertificateType.StakeRegistration,
            stakeCredential: { type: Cardano.CredentialType.ScriptHash, hash: '608634513520c1ede320bdc04e0eb8877565d21de0e52273632e8fa3' as Cardano.Credential['hash'] }
        };
        const built = await finalizeScriptTx(
            {
                inputs: [{ utxo: utxo('1'.repeat(64), 0, BigInt(10_000_000), CHANGE_ADDR) }],
                outputs: [],
                certificates: [registration],
                changeAddress: CHANGE_ADDR,
                signerCount: 1,
                plutusLanguages: [],
                referenceScriptBytes: 0
            },
            params,
            async () => {
                evaluations++;
                return new Map();
            }
        );
        const body = Serialization.Transaction.fromCbor(built.cbor as Serialization.TxCBOR).body().toCore();
        expect(body.certificates).toEqual([registration]);
        expect(evaluations).toBe(0);
        expect(body.scriptIntegrityHash).toBeUndefined();
        expect(built.outputs[0].value.coins + built.fee + params.stakeKeyDeposit).toBe(BigInt(10_000_000));
    });

    it('refuses certificates it cannot balance', () => {
        expect(() => certificateDeposit({ __typename: Cardano.CertificateType.StakeDelegation } as Cardano.Certificate, BigInt(2))).toThrow(/not supported/);
        expect(certificateDeposit({ __typename: Cardano.CertificateType.StakeDeregistration } as Cardano.Certificate, BigInt(2))).toBe(BigInt(-2));
    });
});

describe('selectWalletInputs', () => {
    const withToken = (txId: string, coins: bigint): Cardano.Utxo => {
        const [txIn, txOut] = utxo(txId, 0, coins, CHANGE_ADDR);
        return [txIn, { ...txOut, value: { coins, assets: new Map([[Cardano.AssetId(`${POLICY_A}01`), BigInt(1)]]) } }];
    };
    it('prefers ADA-only UTxOs, largest first, and stops once covered', () => {
        const picked = selectWalletInputs([utxo('1'.repeat(64), 0, BigInt(3), CHANGE_ADDR), withToken('2'.repeat(64), BigInt(100)), utxo('3'.repeat(64), 0, BigInt(9), CHANGE_ADDR), utxo('4'.repeat(64), 0, BigInt(5), CHANGE_ADDR)], BigInt(12));
        expect(picked.map(([i]) => i.txId[0])).toEqual(['3', '4']);
    });
    it('uses token UTxOs only when needed, skips excluded ones, and fails when the wallet is short', () => {
        const all = [utxo('1'.repeat(64), 0, BigInt(3), CHANGE_ADDR), withToken('2'.repeat(64), BigInt(100))];
        expect(selectWalletInputs(all, BigInt(50)).map(([i]) => i.txId[0])).toEqual(['1', '2']);
        expect(() => selectWalletInputs(all, BigInt(50), new Set([`${'2'.repeat(64)}#0`]))).toThrow(/3 spendable lovelace; 50 needed/);
    });
});

describe('addVkeyWitnesses', () => {
    it('adds signatures without touching the body or the redeemer bytes', () => {
        const signed = addVkeyWitnesses(fixture.cbor, [{ vkey: '7'.repeat(64), signature: 'cd'.repeat(64) }]);
        const before = Buffer.from(fixture.cbor, 'hex');
        const after = Buffer.from(signed, 'hex');
        const b0 = locateTxBody(before);
        const b1 = locateTxBody(after);
        expect(after.subarray(b1.start, b1.end).equals(before.subarray(b0.start, b0.end))).toBe(true);
        const tx = Serialization.Transaction.fromCbor(signed as Serialization.TxCBOR);
        expect(tx.witnessSet().redeemers()!.toCbor()).toBe(liveTx.witnessSet().redeemers()!.toCbor());
        expect(tx.witnessSet().vkeys()!.size()).toBe(liveTx.witnessSet().vkeys()!.size() + 1);
    });
});

describe('BlockfrostTxClient', () => {
    afterEach(() => resetRateLimits());
    const respond = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: '', text: async () => JSON.stringify(body), headers: { get: () => null } });

    it('sends additional UTxOs in the value shape Blockfrost evaluates (nested policy -> asset)', () => {
        const [txIn, txOut] = toOgmiosUtxo([
            { txId: Cardano.TransactionId('6'.repeat(64)), index: 0, address: SCRIPT_ADDR as Cardano.PaymentAddress },
            { address: SCRIPT_ADDR as Cardano.PaymentAddress, value: { coins: BigInt(1_474_020), assets: new Map([[Cardano.AssetId(`${POLICY_B}abcd`), BigInt(1)]]) }, datum: constr0().toCore() }
        ]) as [any, any];
        expect(txIn).toEqual({ txId: '6'.repeat(64), index: 0 });
        // Blockfrost rejected the documented flat `assets: { "policy.asset": n }` shape (and even `assets: {}`)
        // with "failed to decode payload"; the nested shape is the one it evaluates with the token present.
        expect(txOut.value).toEqual({ ada: { lovelace: 1_474_020 }, [POLICY_B]: { abcd: 1 } });
        expect(txOut.datum).toBe('d87980');
    });

    it('maps an evaluation result to redeemer keys and throws the failure otherwise', async () => {
        const bodies: any[] = [];
        let reply: unknown = { result: { EvaluationResult: { 'spend:1': { memory: 5, steps: 6 }, 'withdrawal:0': { memory: 1, steps: 2 } } } };
        const client = new BlockfrostTxClient({
            network: 'preview',
            blockfrostApiKey: 'k',
            fetcher: async (url, init) => {
                bodies.push({ url, init });
                return respond(200, reply);
            }
        });
        const units = await client.evaluateTx('84a0', []);
        expect(units.get('spend:1')).toEqual({ memory: 5, steps: 6 });
        expect(units.get('withdrawal:0')).toEqual({ memory: 1, steps: 2 });
        expect(bodies[0].url).toBe('https://cardano-preview.blockfrost.io/api/v0/utils/txs/evaluate/utxos');
        reply = { result: { EvaluationFailure: { ScriptFailures: { 'spend:0': { extraRedeemers: ['spend:0'] } } } } };
        await expect(client.evaluateTx('84a0', [])).rejects.toBeInstanceOf(BlockfrostEvaluationError);
    });

    it('refuses a spent UTxO and reads prices/cost models from cost_models_raw', async () => {
        const client = new BlockfrostTxClient({
            network: 'preview',
            blockfrostApiKey: 'k',
            fetcher: async (url) => {
                if (url.endsWith('/utxos')) return respond(200, { outputs: [{ address: SCRIPT_ADDR, output_index: 0, amount: [{ unit: 'lovelace', quantity: '5' }], consumed_by_tx: 'ab'.repeat(32) }] });
                return respond(200, { ...fixture.params, cost_models: { PlutusV2: { zzz: 1 } } });
            }
        });
        await expect(client.getUtxo(`${'9'.repeat(64)}#0`)).rejects.toThrow(/already spent/);
        const p = await client.getProtocolParameters();
        expect(p.costModels.get(Cardano.PlutusLanguageVersion.V2)).toEqual(fixture.params.cost_models_raw.PlutusV2);
        expect(p.priceSteps).toEqual({ n: BigInt(721), d: BigInt(10000000) });
    });
});

describe('scalus (local UPLC)', () => {
    const utxos = (fixture.utxos as { input: string; output: string }[]).map(
        ({ input, output }) => [Serialization.TransactionInput.fromCbor(input as never).toCore(), Serialization.TransactionOutput.fromCbor(output as never).toCore()] as Cardano.Utxo
    );

    // Invariant: parameters applied off-Helios give the validator the chain knows.
    // Negative control: the neighbouring parameter value gives a different hash.
    it('applies a parameter to a compiled Aiken validator and reproduces the deployed script hash', () => {
        const mintVersion = (n: number) => [Serialization.PlutusData.newInteger(BigInt(n))];
        expect(plutusScriptHash(applyParamsToScript(fixture.halMintProxyCompiledCode, mintVersion(4)), Cardano.PlutusLanguageVersion.V2)).toBe('171e700eae9a90a34ecbd5c8bbf8caf7e6c71f0d5799d8875cbb93a2');
        expect(plutusScriptHash(applyParamsToScript(fixture.halMintProxyCompiledCode, mintVersion(3)), Cardano.PlutusLanguageVersion.V2)).not.toBe('171e700eae9a90a34ecbd5c8bbf8caf7e6c71f0d5799d8875cbb93a2');
    });

    it('converts between the single- and double-CBOR script forms', () => {
        const single = fixture.halMintProxyCompiledCode as string;
        expect(toSingleCbor(toDoubleCbor(single))).toBe(single);
        expect(toDoubleCbor(toDoubleCbor(single))).toBe(toDoubleCbor(single));
    });

    // Invariant: offline evaluation accepts what the node accepts, so tests/tooling can prove validators
    // accept a tx without a network. Its costs are close to, not equal to, the node's (scalus 0.15 prices
    // some scripts ~0.5% higher on protocol 11) — which is why production evaluates with the node.
    it('evaluates every redeemer of a live Plutus tx, within 1% of the node', async () => {
        const evaluate = localEvaluator({ utxos, costModels: params.costModels, network: 'preview' });
        const units = await evaluate(fixture.cbor);
        expect([...units.keys()].sort()).toEqual(Object.keys(fixture.nodeExUnits).sort());
        for (const [key, node] of Object.entries(fixture.nodeExUnits as Record<string, { memory: number; steps: number }>)) {
            const local = units.get(key)!;
            expect(Math.abs(Number(local.steps) - node.steps) / node.steps).toBeLessThan(0.01);
            expect(Math.abs(Number(local.memory) - node.memory) / node.memory).toBeLessThan(0.01);
        }
    });

    it('fails a tx whose redeemer the validator rejects', async () => {
        const evaluate = localEvaluator({ utxos, costModels: params.costModels, network: 'preview' });
        // Replace the minting-data Mint redeemer (spend:1) with Constr 1 [] (UpdateMPT: needs the admin, not given).
        const tx = Serialization.Transaction.fromCbor(fixture.cbor as Serialization.TxCBOR);
        const witnessSet = tx.witnessSet();
        const redeemers = witnessSet.redeemers()!.toCore().map((r) =>
            r.purpose === Cardano.RedeemerPurpose.spend && r.index === 1 ? { ...r, data: Serialization.PlutusData.fromCbor('d87a80' as never).toCore() } : r
        );
        witnessSet.setRedeemers(Serialization.Redeemers.fromCore(redeemers));
        tx.setWitnessSet(witnessSet);
        await expect(evaluate(tx.toCbor())).rejects.toBeDefined();
    });
});
