import * as labelSet from './labelSet';

// CIP-67 label prefixes are 4 bytes = 8 hex chars. These representative values exercise the
// set logic — including the lexicographic==byte sort across hex-digit boundaries (09->0a->10),
// which is the assumption the on-chain `label_set.ak` relies on for `mpt.update` to match.
const A = '000de140'; // higher
const B = '000643b0'; // lower
const L09 = '00000009';
const L0A = '0000000a';
const L10 = '00000010';

describe('mpt/labelSet — canonical CIP-67 label-set value encoding (WS1)', () => {
    describe('insert', () => {
        it('inserts into the empty set', () => {
            expect(labelSet.insert('', A)).toBe(A);
        });
        it('keeps the set sorted ascending regardless of insertion order', () => {
            const built = labelSet.insert(labelSet.insert(labelSet.insert('', B), A), L09);
            expect(built).toBe(L09 + B + A); // 00000009 < 000643b0 < 000de140
        });
        it('canonicalizes to the SAME bytes whatever the insertion order (order-independent)', () => {
            const o1 = labelSet.insert(labelSet.insert(labelSet.insert('', A), B), L09);
            const o2 = labelSet.insert(labelSet.insert(labelSet.insert('', L09), A), B);
            expect(o1).toBe(o2);
        });
        it('lexicographic sort == byte order across hex-digit boundaries (09 < 0a < 10)', () => {
            const s = labelSet.insert(labelSet.insert(labelSet.insert('', L10), L0A), L09);
            expect(s).toBe(L09 + L0A + L10);
        });
        it('throws LABEL_ALREADY_PRESENT on a duplicate', () => {
            expect(() => labelSet.insert(A, A)).toThrow('LABEL_ALREADY_PRESENT');
        });
        it('rejects a label that is not 4 bytes (8 hex chars)', () => {
            expect(() => labelSet.insert('', 'abc')).toThrow(/4 bytes/);
        });
    });

    describe('remove', () => {
        it('removes a present label, keeping the rest sorted', () => {
            expect(labelSet.remove(L09 + B + A, B)).toBe(L09 + A);
        });
        it('throws LABEL_ABSENT when removing a missing label', () => {
            expect(() => labelSet.remove(A, B)).toThrow('LABEL_ABSENT');
        });
    });

    describe('apply (+1/-1 delta couples the value change to the mint/burn)', () => {
        it('+1 inserts, -1 removes — round-trips back to the original', () => {
            const start = labelSet.insert('', A);
            const added = labelSet.apply(start, B, BigInt(1));
            expect(labelSet.contains(added, B)).toBe(true);
            expect(labelSet.apply(added, B, BigInt(-1))).toBe(start);
        });
        it('throws INVALID_AMOUNT for anything but +/-1', () => {
            expect(() => labelSet.apply('', A, BigInt(2))).toThrow('INVALID_AMOUNT');
        });
    });

    describe('contains', () => {
        it('is case-insensitive and respects membership', () => {
            const set = labelSet.insert('', A);
            expect(labelSet.contains(set, A.toUpperCase())).toBe(true);
            expect(labelSet.contains(set, B)).toBe(false);
        });
    });

    describe('valueBuffer (the raw MPT value bytes)', () => {
        it('empty set => empty buffer', () => {
            expect(labelSet.valueBuffer('').length).toBe(0);
        });
        it('decodes the hex set to bytes (NOT the hex string)', () => {
            const set = L09 + A;
            expect(labelSet.valueBuffer(set)).toEqual(Buffer.from(set, 'hex'));
            expect(labelSet.valueBuffer(set).length).toBe(set.length / 2);
        });
    });
});
