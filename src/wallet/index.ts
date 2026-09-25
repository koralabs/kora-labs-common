// Subpath module: `@koralabs/kora-labs-common/wallet`. Isomorphic (browser + Node), no network.
// Reads what a CIP-30 wallet returns (UTxO CBOR, balance CBOR, address hex) with
// @cardano-sdk/core Serialization — never a hand-rolled or generic CBOR decoder.
import { Cardano, Serialization } from '@cardano-sdk/core';

/** The CIP-30 API a dApp gets from `window.cardano[key].enable()` (plus the CIP-95/CIP-103 extensions). */
export interface WalletApi {
    getUtxos: () => Promise<string[] | null | undefined>;
    getCollateral?: () => Promise<string[] | null>;
    getExtensions?: () => Promise<{ cip: number }[]>;
    getBalance: () => Promise<string>;
    getNetworkId: () => Promise<number>;
    getRewardAddresses: () => Promise<string[]>;
    getChangeAddress: () => Promise<string>;
    getUsedAddresses: () => Promise<string[]>;
    getUnusedAddresses: () => Promise<string[]>;
    signTx: (tx: string, partialSign?: boolean) => Promise<string>;
    submitTx: (tx: string) => Promise<string>;
    cip95?: {
        getPubDRepKey: () => Promise<string>;
    };
    cip103?: {
        signTxs: (txs: { cbor: string; partialSign?: boolean }[]) => Promise<string[]>;
        submitTxs: (txs: string[]) => Promise<(string | { error: unknown })[]>;
    };
}

export interface WalletUtxoAsset {
    policyId: string;
    /** Asset name, hex (CIP-68 label included). */
    hex: string;
    count: number;
}

export interface ParsedUtxo {
    /** The wallet's CBOR, untouched (ship this to a backend, never a re-encoding). */
    cbor: string;
    /** `<txHash>#<index>` */
    id: string;
    lovelace: bigint;
    assets: WalletUtxoAsset[];
}

const POLICY_ID_HEX_LENGTH = 56;
// @cardano-sdk's branded hex type, without depending on @cardano-sdk/util directly.
type HexBlob = Parameters<typeof Serialization.Value.fromCbor>[0];
const HexBlob = (hex: string) => hex as HexBlob;

/**
 * Parse one CIP-30 `getUtxos()` entry (`[input, output]` CBOR). Handles legacy array-form and
 * Babbage map-form outputs (inline datum, reference script). Returns null for anything that is not
 * a valid TransactionUnspentOutput, so one malformed entry never hides the rest of the wallet.
 */
export const parseUtxo = (cborHex: string): ParsedUtxo | null => {
    const cbor = cborHex?.trim();
    if (!cbor) return null;
    try {
        const utxo = Serialization.TransactionUnspentOutput.fromCbor(HexBlob(cbor));
        const input = utxo.input();
        const value = utxo.output().amount();
        const assets: WalletUtxoAsset[] = [];
        for (const [assetId, quantity] of value.multiasset() ?? new Map<Cardano.AssetId, bigint>()) {
            assets.push({
                policyId: assetId.slice(0, POLICY_ID_HEX_LENGTH),
                hex: assetId.slice(POLICY_ID_HEX_LENGTH),
                count: Number(quantity)
            });
        }
        return { cbor, id: `${input.transactionId()}#${input.index()}`, lovelace: value.coin(), assets };
    } catch {
        return null;
    }
};

/** Lovelace in a CIP-30 `getBalance()` result (a CBOR `Value`: bare coin or `[coin, multiasset]`). Throws on malformed input. */
export const lovelaceFromBalance = (balanceCborHex: string): bigint => Serialization.Value.fromCbor(HexBlob(balanceCborHex)).coin();

/**
 * CIP-30 returns addresses as hex bytes. Shelley addresses (base, enterprise, pointer, reward) are
 * returned in bech32 with the network's prefix; Byron addresses in base58. '' for empty input;
 * throws on bytes that are not an address.
 */
export const addressHexToBech32 = (addressHex: string): string => {
    const hex = (addressHex ?? '').replace(/^0x/i, '');
    if (!hex) return '';
    const address = Cardano.Address.fromBytes(HexBlob(hex));
    return address.getType() === Cardano.AddressType.Byron ? address.toBase58() : address.toBech32();
};
