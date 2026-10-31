import { DefaultTextFormat, constrToTagged, decodeCborToJson, encodeJsonToDatum } from './index';

// Expected hex values below are worked out by hand from the CBOR / Plutus Constr tag scheme (RFC 8949, CIP-0005).
describe('CBOR codec encoding rules', () => {
    describe('Plutus constructor tags', () => {
        it.each([
            [0, 'd8799fff'],
            [6, 'd87f9fff'], // last compact tag (127)
            [7, 'd905009fff'], // first extended tag (1280)
            [127, 'd905789fff'], // last extended tag (1400)
            [128, 'd8668218809fff'] // beyond 127: tag 102 wrapping [index, fields]
        ])('constructor_%i encodes to the right tag and round-trips', async (index, hex) => {
            const json = { [`constructor_${index}`]: [] };
            expect(await encodeJsonToDatum(json)).toBe(hex);
            expect(decodeCborToJson({ cborString: hex })).toEqual(json);
        });

        it('constrToTagged picks the tag by index range', () => {
            expect(constrToTagged(2, []).tag).toBe(123);
            expect(constrToTagged(10, []).tag).toBe(1283);
            expect(constrToTagged(500, []).tag).toBe(102);
        });
    });

    describe('scalar and container encoding', () => {
        it.each([
            ['plain text becomes bytes', 'abc', undefined, '43616263'],
            ['0x text becomes hex bytes', '0x0a', undefined, '410a'],
            ['~0x escapes the hex prefix', '~0x0a', undefined, '4430783061'],
            ['defaultToText emits a text string', 'abc', { defaultToText: true }, '63616263'],
            ['integers stay integers', 42, undefined, '182a'],
            ['true becomes 1', true, undefined, '01'],
            ['false becomes 0', false, undefined, '00'],
            ['null becomes the bytes "null"', null, undefined, '446e756c6c'],
            ['definite arrays when indefiniteArrays is false', [1, 2], { indefiniteArrays: false }, '820102'],
            ['indefinite arrays by default', [1, 2], undefined, '9f0102ff'],
            ['numeric keys become integers when asked', { '5': 'a' }, { numericKeys: true }, 'a1054161'],
            ['numeric keys stay bytes otherwise', { '5': 'a' }, undefined, 'a141354161'],
            ['floats fall back to their decimal text bytes', 1.5, undefined, '43312e35']
        ])('%s', async (_name, input, options, hex) => {
            expect(await encodeJsonToDatum(input, options as any)).toBe(hex);
        });

        it('splits long byte strings into chunks of chunkSize', async () => {
            expect(await encodeJsonToDatum('abcde', { chunkSize: 2 })).toBe('5f4261624263644165ff');
        });

        it('does not modify the caller JSON, so encoding twice gives the same bytes', async () => {
            const json = { a: ['x', { b: 'y' }] };
            const copy = JSON.parse(JSON.stringify(json));
            const first = await encodeJsonToDatum(json);
            expect(json).toEqual(copy);
            expect(await encodeJsonToDatum(json)).toBe(first);
        });
    });

    describe('decoding', () => {
        it('decodes keys as text and byte values as 0x hex', () => {
            expect(decodeCborToJson({ cborString: 'a141614162' })).toEqual({ a: '0x62' });
        });

        it('rejects input that is not valid CBOR', () => {
            expect(() => decodeCborToJson({ cborString: 'a1' })).toThrow();
        });

        it('hex key format keeps keys as 0x hex', () => {
            const out = decodeCborToJson({ cborString: 'a141614162', defaultKeyType: DefaultTextFormat.HEX });
            expect(Object.keys(out)).toEqual(['0x61']);
        });
    });
});
