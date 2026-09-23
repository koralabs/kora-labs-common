import { Cardano, Serialization } from '@cardano-sdk/core';
import { assertCanonicalCbor, findCanonicalCborViolations, locateWitnessSet, mergeWitnessSet, skipCborItem, txHashFromCbor } from './index';

const ADDRESS = 'addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz';

const buildUnsignedTx = (): string =>
    Serialization.Transaction.fromCore({
        id: '0'.repeat(64),
        body: {
            inputs: [{ txId: 'a'.repeat(64), index: 0 }],
            outputs: [{ address: Cardano.PaymentAddress(ADDRESS), value: { coins: BigInt(2_000_000) } }],
            fee: BigInt(170_000)
        },
        witness: { signatures: new Map() },
        isValid: true
    } as unknown as Cardano.Tx).toCbor();

// vkey witness `[pubkey(32), sig(64)]`
const vkeyWitness = (pubHex: string, sigByte: string) => `825820${pubHex}5840${sigByte.repeat(64)}`;
const PLACEHOLDER_PUB = '00'.repeat(31) + '01';
const BACKEND_PUB = '11'.repeat(32);
const WALLET_PUB = '22'.repeat(32);
// redeemers entry (key 5) holding indefinite-length Plutus data — must survive byte-for-byte.
const REDEEMER_ENTRY = '05' + '81840000' + 'd8799f01ff' + '821a000186a01a000186a0';

const withWitnessSet = (unsignedTxHex: string, witnessSetHex: string): string => {
    const bytes = Buffer.from(unsignedTxHex, 'hex');
    const { start, end } = locateWitnessSet(bytes);
    return Buffer.concat([bytes.subarray(0, start), Buffer.from(witnessSetHex, 'hex'), bytes.subarray(end)]).toString('hex');
};

describe('txHashFromCbor', () => {
    it('matches the ledger tx id computed by cardano-sdk', () => {
        const tx = buildUnsignedTx();
        expect(txHashFromCbor(tx)).toBe(Serialization.Transaction.fromCbor(Serialization.TxCBOR(tx)).getId());
    });

    it('changes when a single body byte changes (negative control)', () => {
        const tx = buildUnsignedTx();
        const mutated = tx.replace('1a00029810', '1a00029811'); // fee 170000 -> 170001
        expect(mutated).not.toBe(tx);
        expect(txHashFromCbor(mutated)).not.toBe(txHashFromCbor(tx));
    });

    it('rejects input that is not a transaction array', () => {
        expect(() => txHashFromCbor('a0')).toThrow('not an array');
    });
});

describe('mergeWitnessSet', () => {
    it('adds wallet vkeys, keeps real backend vkeys, drops placeholders, and preserves body + Plutus bytes', () => {
        const unsigned = withWitnessSet(
            buildUnsignedTx(),
            `a2` + `00d9010282${vkeyWitness(PLACEHOLDER_PUB, 'aa')}${vkeyWitness(BACKEND_PUB, 'bb')}` + REDEEMER_ENTRY
        );
        const walletWs = `a10081${vkeyWitness(WALLET_PUB, 'cc')}`;

        const signed = mergeWitnessSet(unsigned, walletWs);

        expect(txHashFromCbor(signed)).toBe(txHashFromCbor(unsigned));
        expect(signed).toContain(REDEEMER_ENTRY);
        const sigs = Serialization.Transaction.fromCbor(Serialization.TxCBOR(signed)).toCore().witness.signatures;
        expect([...sigs.keys()].sort()).toEqual([BACKEND_PUB, WALLET_PUB]);
        expect(sigs.get(WALLET_PUB as never)).toBe('cc'.repeat(64));
        expect(findCanonicalCborViolations(signed)).toEqual([]);
    });

    it('copies the wallet vkey value verbatim when the unsigned tx has no witnesses', () => {
        const unsigned = buildUnsignedTx();
        const walletVkeys = `d9010281${vkeyWitness(WALLET_PUB, 'cc')}`;
        const signed = mergeWitnessSet(unsigned, `a100${walletVkeys}`);
        const { start, end } = locateWitnessSet(Buffer.from(signed, 'hex'));
        expect(signed.slice(start * 2, end * 2)).toBe(`a100${walletVkeys}`);
    });

    it('returns the tx unchanged when the wallet returns no vkey witnesses', () => {
        const unsigned = buildUnsignedTx();
        expect(mergeWitnessSet(unsigned, 'a0')).toBe(unsigned);
    });

    it('rejects an indefinite-length witness map it cannot splice safely', () => {
        const unsigned = withWitnessSet(buildUnsignedTx(), `bf${REDEEMER_ENTRY}ff`);
        expect(() => mergeWitnessSet(unsigned, `a10081${vkeyWitness(WALLET_PUB, 'cc')}`)).toThrow('Indefinite-length');
    });
});

describe('skipCborItem', () => {
    it('walks nested indefinite containers and tags', () => {
        const item = Buffer.from('d8799f9f0102ffbf0102ff44deadbeefff00', 'hex');
        expect(skipCborItem(item, 0)).toBe(item.length - 1);
    });
});

describe('canonical CBOR check', () => {
    it('accepts a canonical SDK-built transaction', () => {
        expect(() => assertCanonicalCbor(buildUnsignedTx())).not.toThrow();
    });

    it('flags a body map whose keys are out of canonical order', () => {
        const tx = buildUnsignedTx();
        // body = a3 00<inputs> 01<outputs> 02<fee>; move the fee entry to the front.
        const bytes = Buffer.from(tx, 'hex');
        const bodyStart = 1;
        const bodyEnd = skipCborItem(bytes, bodyStart);
        const body = bytes.subarray(bodyStart, bodyEnd).toString('hex');
        const feeEntry = '021a00029810';
        const reordered = 'a3' + feeEntry + body.slice(2).replace(feeEntry, '');
        const bad = tx.replace(body, reordered);
        expect(findCanonicalCborViolations(bad)).toEqual([expect.objectContaining({ path: 'tx[0]' })]);
        expect(() => assertCanonicalCbor(bad, 'order')).toThrow('CBOR is not canonical (order)');
    });

    it('does not police key order inside Plutus data', () => {
        // redeemer data is a map with keys 2,1 (non-canonical) — legal, hashed as-is.
        const tx = withWitnessSet(buildUnsignedTx(), 'a10581840000a20201010200821a000186a01a000186a0');
        expect(findCanonicalCborViolations(tx)).toEqual([]);
    });
});
