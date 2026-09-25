// CIP-68 reference-datum -> `onchain_metadata`, exactly as Blockfrost reports it for `/assets/{unit}`.
//
// Ported from blockfrost-utils `src/cip68.ts` (getMetadataFromOutputDatum / convertDatumValue,
// github.com/blockfrost/blockfrost-utils @ b467b2a). Providers without that endpoint (Koios) read the
// reference token's datum and convert it here, so every consumer sees ONE metadata shape whichever
// provider answered. Blockfrost's quirks are kept on purpose: only the CIP-68 schema fields of the
// token's standard are decoded (bytes -> UTF-8, or hex when not valid UTF-8); every other field keeps
// the value's ORIGINAL CBOR hex (consumers such as the HAL BFF decode those themselves).
import cbor from 'cbor';
import { readCborHeader, skipCborItem } from '../../tx/cbor';

export type Cip68Standard = 'ft' | 'nft' | 'rft';

type PropertyScheme = {
    type: 'bytestring' | 'number' | 'array';
    optional?: boolean;
    items?: Record<string, PropertyScheme>;
};
type MetadataScheme = Record<string, PropertyScheme>;

const FILES: PropertyScheme = {
    type: 'array',
    optional: true,
    items: {
        name: { type: 'bytestring', optional: true },
        mediaType: { type: 'bytestring' },
        src: { type: 'bytestring' }
    }
};

const METADATA_SCHEME_MAP: Record<Cip68Standard, MetadataScheme> = {
    ft: {
        name: { type: 'bytestring' },
        description: { type: 'bytestring' },
        ticker: { type: 'bytestring', optional: true },
        url: { type: 'bytestring', optional: true },
        logo: { type: 'bytestring', optional: true },
        decimals: { type: 'number', optional: true }
    },
    nft: {
        name: { type: 'bytestring' },
        image: { type: 'bytestring' },
        mediaType: { type: 'bytestring', optional: true },
        description: { type: 'bytestring', optional: true },
        files: FILES
    },
    rft: {
        name: { type: 'bytestring' },
        image: { type: 'bytestring' },
        mediaType: { type: 'bytestring', optional: true },
        description: { type: 'bytestring', optional: true },
        decimals: { type: 'number', optional: true },
        files: FILES
    }
};

/** CIP-67 labels (with checksum) of the CIP-68 user tokens Blockfrost resolves, and of the reference NFT. */
export const CIP68_REFERENCE_LABEL = '000643b0';
const USER_TOKEN_STANDARDS: Record<string, Cip68Standard> = { '000de140': 'nft', '0014df10': 'ft', '001bc280': 'rft' };

/** For a CIP-68 user token (222/333/444) asset-name hex: its standard and reference-NFT asset-name hex. */
export const cip68ReferenceOf = (hex: string): { standard: Cip68Standard; referenceHex: string } | null => {
    const standard = USER_TOKEN_STANDARDS[hex.slice(0, 8)];
    return standard ? { standard, referenceHex: `${CIP68_REFERENCE_LABEL}${hex.slice(8)}` } : null;
};

/** Port of the UTF-8 validator Blockfrost uses (websockets/utf-8-validate fallback). */
export const isValidUTF8 = (buf: Buffer): boolean => {
    const len = buf.length;
    let i = 0;
    while (i < len) {
        if ((buf[i] & 0x80) === 0x00) {
            i++;
        } else if ((buf[i] & 0xe0) === 0xc0) {
            if (i + 1 === len || (buf[i + 1] & 0xc0) !== 0x80 || (buf[i] & 0xfe) === 0xc0) return false;
            i += 2;
        } else if ((buf[i] & 0xf0) === 0xe0) {
            if (
                i + 2 >= len ||
                (buf[i + 1] & 0xc0) !== 0x80 ||
                (buf[i + 2] & 0xc0) !== 0x80 ||
                (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) ||
                (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0)
            ) {
                return false;
            }
            i += 3;
        } else if ((buf[i] & 0xf8) === 0xf0) {
            if (
                i + 3 >= len ||
                (buf[i + 1] & 0xc0) !== 0x80 ||
                (buf[i + 2] & 0xc0) !== 0x80 ||
                (buf[i + 3] & 0xc0) !== 0x80 ||
                (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) ||
                (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
                buf[i] > 0xf4
            ) {
                return false;
            }
            i += 4;
        } else {
            return false;
        }
    }
    return true;
};

const toUTF8OrHex = (buffer: Buffer) => (isValidUTF8(buffer) ? buffer.toString('utf8') : buffer.toString('hex'));

const convertDatumValue = (decodedValue: unknown, schema: PropertyScheme | Record<string, PropertyScheme> | null): unknown => {
    if (!schema) return null;
    const scheme = schema as PropertyScheme;
    if (scheme.type === 'number' && typeof decodedValue === 'number') return decodedValue;
    if (scheme.type === 'bytestring' && Buffer.isBuffer(decodedValue)) return toUTF8OrHex(decodedValue);
    if (scheme.type === 'bytestring' && Array.isArray(decodedValue)) return toUTF8OrHex(Buffer.concat(decodedValue));
    if (Array.isArray(decodedValue)) {
        const converted: unknown[] = [];
        for (const item of decodedValue) {
            const value = convertDatumValue(item, scheme.items ?? null);
            if (value === null) return null;
            converted.push(value);
        }
        return converted;
    }
    if (decodedValue instanceof Map) {
        const metadataMap: Record<string, unknown> = {};
        for (const [key, mapValue] of decodedValue.entries()) {
            const convertedKey = Buffer.isBuffer(key) ? toUTF8OrHex(key) : key;
            const valueSchema = schema && convertedKey in schema ? (schema as any)[convertedKey] : null;
            const value = convertDatumValue(mapValue, valueSchema);
            if (value === null) return null;
            metadataMap[convertedKey] = value;
        }
        return metadataMap;
    }
    return null;
};

/** Start/end of the constructor's fields list: `#6.121..127/1280..1400([fields])` or `#6.102([index, [fields]])`. */
const constrFields = (bytes: Buffer): number | null => {
    const tag = readCborHeader(bytes, 0);
    if (tag.majorType !== 6) return null;
    const isCompact = (tag.length >= 121 && tag.length <= 127) || (tag.length >= 1280 && tag.length <= 1400);
    if (isCompact) return tag.headerEnd;
    if (tag.length !== 102) return null;
    const pair = readCborHeader(bytes, tag.headerEnd);
    return pair.majorType === 4 ? skipCborItem(bytes, pair.headerEnd) : null;
};

/** The CBOR items of the list starting at `start` (definite or indefinite), as [start, end) spans. */
const listItems = (bytes: Buffer, start: number): [number, number][] | null => {
    const header = readCborHeader(bytes, start);
    if (header.majorType !== 4) return null;
    const spans: [number, number][] = [];
    let cursor = header.headerEnd;
    const indefinite = header.additionalInfo === 31;
    for (let i = 0; indefinite ? bytes[cursor] !== 0xff : i < header.length; i++) {
        const end = skipCborItem(bytes, cursor);
        spans.push([cursor, end]);
        cursor = end;
    }
    return spans;
};

/**
 * Blockfrost's `onchain_metadata` for a CIP-68 token whose reference NFT carries `datumHex`, or null
 * when the datum is not a CIP-68 `Constr [metadata_map, version, extra?]`.
 */
export const cip68OnchainMetadata = (datumHex: string, standard: Cip68Standard): Record<string, unknown> | null => {
    const bytes = Buffer.from(datumHex, 'hex');
    let fields: [number, number][] | null;
    try {
        const fieldsStart = constrFields(bytes);
        fields = fieldsStart === null ? null : listItems(bytes, fieldsStart);
    } catch {
        return null;
    }
    // [metadata, version] are mandatory
    if (!fields || fields.length < 2) return null;
    const [mapStart] = fields[0];
    const map = readCborHeader(bytes, mapStart);
    if (map.majorType !== 5) return null;

    const schema = METADATA_SCHEME_MAP[standard];
    const metadata: Record<string, unknown> = {};
    const seenKeys = new Set<string>();
    let cursor = map.headerEnd;
    const indefinite = map.additionalInfo === 31;
    for (let i = 0; indefinite ? bytes[cursor] !== 0xff : i < map.length; i++) {
        const keyEnd = skipCborItem(bytes, cursor);
        const valueEnd = skipCborItem(bytes, keyEnd);
        const keyBytes = bytes.subarray(cursor, keyEnd);
        const valueBytes = bytes.subarray(keyEnd, valueEnd);
        cursor = valueEnd;
        // CSL's PlutusMap groups a repeated key's values and Blockfrost reads the first one.
        const keyId = keyBytes.toString('hex');
        if (seenKeys.has(keyId)) continue;
        seenKeys.add(keyId);

        const decodedKey = cbor.decodeFirstSync(keyBytes);
        const convertedKey = Buffer.isBuffer(decodedKey) ? toUTF8OrHex(decodedKey) : decodedKey;
        const valueHex = valueBytes.toString('hex');
        if (!(schema && convertedKey in schema)) {
            // Custom field not covered by the CIP-68 standard: unparsed CBOR
            metadata[convertedKey] = valueHex;
        } else {
            const converted = convertDatumValue(cbor.decodeFirstSync(valueBytes), (schema as any)[convertedKey]);
            metadata[convertedKey] = converted !== null ? converted : valueHex;
        }
    }
    return metadata;
};
