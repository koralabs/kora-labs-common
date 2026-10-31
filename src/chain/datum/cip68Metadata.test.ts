import { readFileSync } from 'fs';
import { join } from 'path';
import { cip68OnchainMetadata, cip68ReferenceOf, isValidUTF8 } from './cip68Metadata';

const fixtures: { assets: { unit: string; referenceDatum: string; blockfrostOnchainMetadata: Record<string, unknown> }[] } = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'cip68PreviewAssets.json'), 'utf8')
);

// Invariant: a CIP-68 token's metadata is the same whichever provider answered — the conversion of the
// reference datum Koios returns equals the `onchain_metadata` Blockfrost reports, byte for byte.
describe('cip68OnchainMetadata', () => {
    it('reproduces Blockfrost onchain_metadata for every recorded preview HAL-mint asset (222 + 444)', () => {
        expect(fixtures.assets.length).toBeGreaterThanOrEqual(40);
        for (const { unit, referenceDatum, blockfrostOnchainMetadata } of fixtures.assets) {
            const reference = cip68ReferenceOf(unit.slice(56));
            expect(reference).not.toBeNull();
            expect({ unit, metadata: cip68OnchainMetadata(referenceDatum, reference!.standard) }).toEqual({ unit, metadata: blockfrostOnchainMetadata });
        }
    });

    it('keeps non-schema fields as their original CBOR and decodes schema fields to UTF-8', () => {
        // Constr0 [ {name: "Hi", Chest: "Military", files: [{src: "ipfs://x", mediaType: "a/b"}]}, 1 ]
        const hex = (s: string) => Buffer.from(s).toString('hex');
        const bytes = (s: string) => `${(0x40 + s.length).toString(16)}${hex(s)}`;
        const map = `a3${bytes('name')}${bytes('Hi')}${bytes('Chest')}${bytes('Military')}${bytes('files')}81a2${bytes('src')}${bytes('ipfs://x')}${bytes('mediaType')}${bytes('a/b')}`;
        const datum = `d8799f${map}01ff`;
        expect(cip68OnchainMetadata(datum, 'nft')).toEqual({
            name: 'Hi',
            Chest: `48${hex('Military')}`,
            files: [{ src: 'ipfs://x', mediaType: 'a/b' }]
        });
        // the same field outside the nft schema (ft has no `files`) stays CBOR
        expect(cip68OnchainMetadata(datum, 'ft')!.files).toBe(`81a2${bytes('src')}${bytes('ipfs://x')}${bytes('mediaType')}${bytes('a/b')}`);
    });

    it('returns null for datums that are not CIP-68 metadata, and resolves only user-token labels', () => {
        expect(cip68OnchainMetadata('d87980', 'nft')).toBeNull(); // Constr0 [] — no [metadata, version]
        expect(cip68OnchainMetadata('d8799f01a0ff', 'nft')).toBeNull(); // first field is not a map
        expect(cip68OnchainMetadata('4568656c6c6f', 'nft')).toBeNull(); // not a constructor
        expect(cip68ReferenceOf('000de140abcd')).toEqual({ standard: 'nft', referenceHex: '000643b0abcd' });
        expect(cip68ReferenceOf('001bc280abcd')).toEqual({ standard: 'rft', referenceHex: '000643b0abcd' });
        expect(cip68ReferenceOf('000643b0abcd')).toBeNull();
        expect(cip68ReferenceOf('48414c')).toBeNull();
    });
});

// Invariant: isValidUTF8 agrees with Node's strict decoder, so a byte string is shown as text only if it truly is UTF-8.
describe('isValidUTF8', () => {
    const strict = (b: Buffer) => {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(b);
            return true;
        } catch {
            return false;
        }
    };
    const cases: [string, number[]][] = [
        ['ascii', [0x68, 0x69]],
        ['2-byte', [0xc3, 0xa9]],
        ['3-byte', [0xe2, 0x82, 0xac]],
        ['4-byte emoji', [0xf0, 0x9f, 0x98, 0x80]],
        ['truncated 2-byte', [0xc3]],
        ['bad continuation 2-byte', [0xc3, 0x28]],
        ['overlong 2-byte', [0xc0, 0x80]],
        ['truncated 3-byte', [0xe2, 0x82]],
        ['overlong 3-byte', [0xe0, 0x80, 0x80]],
        ['surrogate', [0xed, 0xa0, 0x80]],
        ['truncated 4-byte', [0xf0, 0x9f, 0x98]],
        ['overlong 4-byte', [0xf0, 0x80, 0x80, 0x80]],
        ['above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
        ['invalid lead byte', [0xf8, 0x88, 0x80, 0x80, 0x80]],
        ['lone continuation', [0x80]]
    ];
    it.each(cases)('%s', (_n, bytes) => {
        const buf = Buffer.from(bytes);
        expect(isValidUTF8(buf)).toBe(strict(buf));
    });
    it('accepts only the valid ones among the cases (negative control)', () => {
        expect(cases.filter(([, b]) => isValidUTF8(Buffer.from(b))).map(([n]) => n)).toEqual(['ascii', '2-byte', '3-byte', '4-byte emoji']);
    });
});
