// Subpath module: `@koralabs/kora-labs-common/tx`. Isomorphic (browser + Node), no network.
import { blake2bHex } from 'blakejs';
import { locateTxBody } from './cbor';

export * from './cbor';

/** Transaction id = blake2b-256 over the exact body bytes. Use it to prove the tx that was
 *  signed/submitted is byte-for-byte the tx the backend built. */
export const txHashFromCbor = (txHex: string): string => {
    const bytes = Buffer.from(txHex, 'hex');
    const { start, end } = locateTxBody(bytes);
    return blake2bHex(bytes.subarray(start, end), undefined, 32);
};
