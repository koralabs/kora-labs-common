// Byte-level CBOR helpers for signed-transaction assembly. Pure functions, no deps beyond Buffer,
// so they are safe in the browser (wallet contexts) and in Node (test harnesses).
//
// Why byte-level: decoding a built tx into an SDK object and re-encoding it can change bytes
// (definite vs indefinite arrays, integer widths, key order). The node hashes the exact bytes it
// receives, so any re-encode after the backend computed script_data_hash / the body hash breaks
// the tx (PPViewHashesDontMatch, or a signature over a body that no longer exists).

export interface CborHeader {
    majorType: number;
    additionalInfo: number;
    length: number;
    headerEnd: number;
}

export const readCborHeader = (buf: Uint8Array, start: number): CborHeader => {
    const majorType = buf[start] >> 5;
    const additionalInfo = buf[start] & 0x1f;
    let headerEnd = start + 1;
    let length = additionalInfo;
    if (additionalInfo === 24) {
        length = buf[start + 1];
        headerEnd = start + 2;
    } else if (additionalInfo === 25) {
        length = (buf[start + 1] << 8) | buf[start + 2];
        headerEnd = start + 3;
    } else if (additionalInfo === 26) {
        length = buf[start + 1] * 0x1000000 + ((buf[start + 2] << 16) | (buf[start + 3] << 8) | buf[start + 4]);
        headerEnd = start + 5;
    } else if (additionalInfo === 27) {
        let v = 0;
        for (let i = 0; i < 8; i++) v = v * 256 + buf[start + 1 + i];
        length = v;
        headerEnd = start + 9;
    } else if (additionalInfo >= 28 && additionalInfo <= 30) {
        throw new Error(`Unsupported CBOR additional info ${additionalInfo} at byte ${start}`);
    }
    return { majorType, additionalInfo, length, headerEnd };
};

/** Return the offset immediately after the CBOR item starting at `start`. */
export const skipCborItem = (buf: Uint8Array, start: number): number => {
    const { majorType, additionalInfo, length, headerEnd } = readCborHeader(buf, start);
    if (additionalInfo === 31) {
        let c = headerEnd;
        while (buf[c] !== 0xff) {
            c = skipCborItem(buf, c);
            if (majorType === 5) c = skipCborItem(buf, c);
        }
        return c + 1;
    }
    if (majorType <= 1 || majorType === 7) return headerEnd;
    if (majorType === 2 || majorType === 3) return headerEnd + length;
    if (majorType === 6) return skipCborItem(buf, headerEnd);
    let c = headerEnd;
    const items = majorType === 5 ? length * 2 : length;
    for (let i = 0; i < items; i++) c = skipCborItem(buf, c);
    return c;
};

/** Byte span of the witness set (element 1) inside `transaction = [body, witness_set, is_valid, aux]`. */
export const locateWitnessSet = (txBytes: Uint8Array): { start: number; end: number } => {
    const outer = readCborHeader(txBytes, 0);
    if (outer.majorType !== 4) throw new Error('Transaction CBOR is not an array');
    const start = skipCborItem(txBytes, outer.headerEnd);
    return { start, end: skipCborItem(txBytes, start) };
};

/** Byte span of the transaction body (element 0). The tx id is blake2b-256 over exactly these bytes. */
export const locateTxBody = (txBytes: Uint8Array): { start: number; end: number } => {
    const outer = readCborHeader(txBytes, 0);
    if (outer.majorType !== 4) throw new Error('Transaction CBOR is not an array');
    return { start: outer.headerEnd, end: skipCborItem(txBytes, outer.headerEnd) };
};

const encodeUintHeader = (majorType: number, value: number): Buffer => {
    const tag = majorType << 5;
    if (value < 24) return Buffer.from([tag | value]);
    if (value < 0x100) return Buffer.from([tag | 24, value]);
    if (value < 0x10000) return Buffer.from([tag | 25, (value >> 8) & 0xff, value & 0xff]);
    return Buffer.from([tag | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
};

interface MapEntry {
    keyStart: number;
    keyEnd: number;
    valueStart: number;
    valueEnd: number;
}

const parseMapEntries = (buf: Uint8Array, mapStart: number): MapEntry[] => {
    const hdr = readCborHeader(buf, mapStart);
    if (hdr.majorType !== 5) throw new Error('Expected CBOR map for witness set');
    if (hdr.additionalInfo === 31) throw new Error('Indefinite-length witness-set map not supported');
    const entries: MapEntry[] = [];
    let off = hdr.headerEnd;
    for (let i = 0; i < hdr.length; i++) {
        const keyEnd = skipCborItem(buf, off);
        const valueEnd = skipCborItem(buf, keyEnd);
        entries.push({ keyStart: off, keyEnd, valueStart: keyEnd, valueEnd });
        off = valueEnd;
    }
    return entries;
};

const findUintKey = (entries: MapEntry[], buf: Uint8Array, key: number) =>
    entries.find((e) => {
        const hdr = readCborHeader(buf, e.keyStart);
        return hdr.majorType === 0 && hdr.length === key && hdr.headerEnd === e.keyEnd;
    });

// `tag(258, array)` (Conway set) or a bare array → element count + raw element bytes.
const splitVkeyArray = (buf: Uint8Array, valueStart: number, valueEnd: number) => {
    let off = valueStart;
    const first = readCborHeader(buf, off);
    if (first.majorType === 6 && first.length === 258) off = first.headerEnd;
    const arr = readCborHeader(buf, off);
    if (arr.majorType !== 4) throw new Error('Expected vkey-witness array');
    if (arr.additionalInfo === 31) throw new Error('Indefinite-length vkey-witness array not supported');
    return { count: arr.length, itemsBytes: Buffer.from(buf.slice(arr.headerEnd, valueEnd)) };
};

// Backends size fees with placeholder vkeys whose pubkeys are (almost) all zero. Those must be
// replaced by real signatures, never kept alongside them. A real ed25519 pubkey never begins with
// 28+ zero bytes.
const dropPlaceholderVkeys = (itemsBytes: Buffer, count: number) => {
    const kept: Buffer[] = [];
    let off = 0;
    for (let i = 0; i < count; i++) {
        const itemStart = off;
        const arr = readCborHeader(itemsBytes, off);
        const pub = readCborHeader(itemsBytes, arr.headerEnd);
        const pubBytes = itemsBytes.subarray(pub.headerEnd, pub.headerEnd + pub.length);
        off = skipCborItem(itemsBytes, skipCborItem(itemsBytes, arr.headerEnd));
        let leadingZeros = 0;
        for (const b of pubBytes) {
            if (b !== 0) break;
            leadingZeros++;
        }
        if (leadingZeros < 28) kept.push(itemsBytes.subarray(itemStart, off));
    }
    return { itemsBytes: Buffer.concat(kept), count: kept.length };
};

/**
 * Merge a CIP-30 `signTx(tx, partialSign=true)` witness set into the unsigned tx WITHOUT
 * re-encoding the body or any non-vkey witness entry (scripts, redeemers, datums stay
 * byte-identical). Existing real vkey witnesses (e.g. a backend policy pre-sign) are preserved;
 * fee-estimation placeholders are dropped.
 */
export const mergeWitnessSet = (unsignedTxHex: string, walletWitnessSetHex: string): string => {
    const txBytes = Buffer.from(unsignedTxHex, 'hex');
    const walletBytes = Buffer.from(walletWitnessSetHex, 'hex');
    const { start: wsStart, end: wsEnd } = locateWitnessSet(txBytes);

    const existing = parseMapEntries(txBytes, wsStart);
    const wallet = parseMapEntries(walletBytes, 0);
    const existingVkey = findUintKey(existing, txBytes, 0);
    const walletVkey = findUintKey(wallet, walletBytes, 0);
    if (!walletVkey) return unsignedTxHex;

    let mergedVkeyValue: Buffer;
    if (existingVkey) {
        const ours = splitVkeyArray(txBytes, existingVkey.valueStart, existingVkey.valueEnd);
        const kept = dropPlaceholderVkeys(ours.itemsBytes, ours.count);
        const theirs = splitVkeyArray(walletBytes, walletVkey.valueStart, walletVkey.valueEnd);
        mergedVkeyValue = Buffer.concat([
            Buffer.from([0xd9, 0x01, 0x02]),
            encodeUintHeader(4, kept.count + theirs.count),
            kept.itemsBytes,
            theirs.itemsBytes
        ]);
    } else {
        mergedVkeyValue = Buffer.from(walletBytes.subarray(walletVkey.valueStart, walletVkey.valueEnd));
    }

    // Key 0 first keeps the witness map canonical; every other entry is copied byte-for-byte.
    const others = existing.filter((e) => e !== existingVkey);
    const newWitnessSet = Buffer.concat([
        encodeUintHeader(5, others.length + 1),
        Buffer.from([0x00]),
        mergedVkeyValue,
        ...others.map((e) => txBytes.subarray(e.keyStart, e.valueEnd))
    ]);
    return Buffer.concat([txBytes.subarray(0, wsStart), newWitnessSet, txBytes.subarray(wsEnd)]).toString('hex');
};

export interface CanonicalViolation {
    path: string;
    detail: string;
}

const compareEncodedKeys = (a: Buffer, b: Buffer): number => (a.length !== b.length ? a.length - b.length : Buffer.compare(a, b));

/**
 * Canonical-CBOR check (CIP-21 key order) for the transaction-structure maps only: the body map
 * (tx[0]) and the witness map (tx[1]). Hardware wallets and Eternl reject a tx whose structure maps
 * are out of canonical order. Plutus data and multi-asset maps are deliberately NOT checked — they
 * are hashed as-is and canonicalizing them would change hashes.
 */
export const findCanonicalCborViolations = (txHex: string): CanonicalViolation[] => {
    const b = Buffer.from(txHex, 'hex');
    const violations: CanonicalViolation[] = [];

    const walk = (p: number, path: string, checkMapKeys: boolean): number => {
        const { majorType, additionalInfo, length, headerEnd } = readCborHeader(b, p);
        const indefinite = additionalInfo === 31;
        let q = headerEnd;
        switch (majorType) {
            case 0:
            case 1:
            case 7:
                return q;
            case 2:
            case 3:
                if (indefinite) {
                    while (b[q] !== 0xff) q = walk(q, path, false);
                    return q + 1;
                }
                return q + length;
            case 4: {
                let i = 0;
                while (indefinite ? b[q] !== 0xff : i < length) q = walk(q, `${path}[${i++}]`, false);
                return indefinite ? q + 1 : q;
            }
            case 5: {
                if (indefinite && checkMapKeys) violations.push({ path, detail: 'indefinite-length transaction map' });
                let prevKey: Buffer | null = null;
                for (let i = 0; indefinite ? b[q] !== 0xff : i < length; i++) {
                    const keyStart = q;
                    q = walk(q, `${path}{k${i}}`, false);
                    if (checkMapKeys) {
                        const keyBytes = Buffer.from(b.subarray(keyStart, q));
                        if (prevKey && compareEncodedKeys(prevKey, keyBytes) > 0) {
                            violations.push({
                                path,
                                detail: `key #${i} (0x${keyBytes.toString('hex')}) out of canonical order (follows 0x${prevKey.toString('hex')})`
                            });
                        }
                        prevKey = keyBytes;
                    }
                    q = walk(q, `${path}{v${i}}`, false);
                }
                return indefinite ? q + 1 : q;
            }
            case 6:
                return walk(q, `${path}/tag(${length})`, false);
            default:
                throw new Error(`bad major type ${majorType} at byte ${p}`);
        }
    };

    try {
        const outer = readCborHeader(b, 0);
        if (outer.majorType !== 4) throw new Error('transaction is not a CBOR array');
        let q = outer.headerEnd;
        for (let i = 0; i < outer.length && q < b.length; i++) q = walk(q, `tx[${i}]`, i === 0 || i === 1);
    } catch (e) {
        violations.push({ path: 'tx', detail: `parse error: ${(e as Error).message}` });
    }
    return violations;
};

export const assertCanonicalCbor = (txHex: string, label = 'tx'): void => {
    const violations = findCanonicalCborViolations(txHex);
    if (violations.length > 0) {
        const lines = violations
            .slice(0, 12)
            .map((v) => `  - ${v.path}: ${v.detail}`)
            .join('\n');
        throw new Error(`CBOR is not canonical (${label}) — a hardware wallet / Eternl would reject this tx at signing:\n${lines}`);
    }
};
