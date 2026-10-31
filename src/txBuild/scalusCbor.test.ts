import { Serialization } from '@cardano-sdk/core';
import { plutusDataToJson, toDoubleCbor, toSingleCbor } from './scalus';

// A "single CBOR" script: a CBOR byte string of n program bytes.
const header = (n: number) => (n <= 23 ? Buffer.from([0x40 | n]) : n <= 0xff ? Buffer.from([0x58, n]) : n <= 0xffff ? Buffer.from([0x59, n >> 8, n & 255]) : Buffer.from([0x5a, 0, n >> 16, (n >> 8) & 255, n & 255]));
const single = (n: number) => Buffer.concat([header(n), Buffer.alloc(n, 0x01)]).toString('hex');

describe('scalus CBOR wrapping across byte-string header sizes', () => {
    // Invariant: single<->double conversion round-trips for every CBOR length header form.
    it.each([5, 23, 24, 255, 256, 70000])('round-trips a %i byte program', (n) => {
        const s = single(n);
        const double = toDoubleCbor(s);
        expect(double).not.toBe(s);
        expect(toSingleCbor(double)).toBe(s);
    });
    it('uses the expected header bytes', () => {
        expect(toDoubleCbor(single(22)).slice(0, 2)).toBe('57');
        expect(toDoubleCbor(single(23)).slice(0, 4)).toBe('5818');
        expect(toDoubleCbor(single(254)).slice(0, 6)).toBe('590100');
        expect(toDoubleCbor(single(70000)).slice(0, 10)).toBe('5a00011175');
    });
    it('rejects input that is not a byte string', () => {
        expect(() => toSingleCbor('01')).toThrow('expected a CBOR byte string');
        expect(() => toDoubleCbor('')).toThrow('expected a CBOR byte string');
    });
    it('rejects 8-byte length headers', () => {
        expect(() => toSingleCbor('5b' + '00'.repeat(8))).toThrow('unsupported CBOR byte string header 0x5b');
    });
});

describe('plutusDataToJson', () => {
    const from = (cbor: string) => Serialization.PlutusData.fromCbor(cbor as never);
    it('converts ints, bytes, lists, maps and constructors', () => {
        expect(plutusDataToJson(from('182a'))).toEqual({ int: 42 });
        expect(plutusDataToJson(from('42abcd'))).toEqual({ bytes: 'abcd' });
        expect(plutusDataToJson(from('820102'))).toEqual({ list: [{ int: 1 }, { int: 2 }] });
        expect(plutusDataToJson(from('a1014161'))).toEqual({ map: [{ k: { int: 1 }, v: { bytes: '61' } }] });
        expect(plutusDataToJson(from('d87a8101'))).toEqual({ constructor: 1, fields: [{ int: 1 }] });
    });
    it('refuses integers outside the safe range', () => {
        expect(() => plutusDataToJson(from('1b' + '0020000000000000'))).toThrow('outside the safe range');
    });
});
