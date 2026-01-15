import { bech32 } from 'bech32';
import { blake2bHex } from 'blakejs';
import bs58 from 'bs58';
import { crc8 } from 'crc';
import { IS_PRODUCTION, IS_SERVER, NETWORK } from '../../constants';
import { contractsRegistry } from '../../constants/contractsRegistry';
import { Logger } from '../../logger';
import { AddressDetails, AddressType, AssetNameLabel, StakeAddressType } from '../../types';
import { decodeCborToJson } from '../cbor';

// var verifier = await getRandomCodeVerifier(64);
// var challenge = await getChallengeFromVerifier(verifier);

export const getNativeCrypto = async (): Promise<any> => {
    if (IS_SERVER) {
        return await import('crypto');
    }
    return window.crypto;
}

export function dec2hex(dec: number) { 
    return ('0' + dec.toString(16)).slice(-2)
}

export async function getRandomCodeVerifier(length: number) {
    const crypto = await getNativeCrypto();
    const array = new Uint32Array(length / 2);
    crypto.getRandomValues(array);
    return Array.from(array, dec2hex).join('');
}

export const sha256 = async (plain: string): Promise<ArrayBuffer> => {
    const crypto = await getNativeCrypto();
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

export function base64urlencode(a: ArrayBuffer) {
    let str = '';
    const bytes = new Uint8Array(a);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function getChallengeFromVerifier(verifier: string) {
    const hashed = await sha256(verifier);
    const base64encoded = base64urlencode(hashed);
    return base64encoded;
}

export const decodeAddress = (address: string): string | null => {
    try {
        const addressWords = bech32.decode(address, address.length);
        const payload = bech32.fromWords(addressWords.words);
        return `${Buffer.from(payload).toString('hex')}`;
    } catch (error) {
        return null;
    }
};

export const parseAssetNameLabel = (assetName: string): AssetNameLabel => {
    const maybeAssetNameLabel = assetName.slice(0, 8);
    return Object.values(AssetNameLabel).includes(maybeAssetNameLabel as AssetNameLabel) ? maybeAssetNameLabel as AssetNameLabel : AssetNameLabel.NONE
}

export const checkNameLabel = (assetName: string): { isCip67: boolean, assetLabel: AssetNameLabel, name: string } => {
    const assetNameString = typeof assetName === 'string' ? assetName : new TextDecoder().decode(assetName);
    let isCip67 = false;
    let assetLabel = AssetNameLabel.NONE;
    let utf8Name = Buffer.from(assetName, 'hex').toString('utf8');
    if (assetNameString.length >= 8) {
        const maybeAssetLabel = assetNameString.slice(0, 8);
        if (maybeAssetLabel.startsWith('0') && maybeAssetLabel.endsWith('0')) {
            const label = maybeAssetLabel.slice(1, 5);
            const check = maybeAssetLabel.slice(5, 7);
            if (crc8(Buffer.from(label, 'hex')).toString(16).padStart(2, '0') == check) {
                isCip67 = true;
                assetLabel = parseAssetNameLabel(assetName);
                utf8Name = Buffer.from(assetName.slice(8), 'hex').toString('utf8');
            }
        }
    }
    return {
        isCip67,
        assetLabel,
        name: utf8Name
    };
};

export const getPaymentAddressType = (headerByte: number): AddressType => {
    // https://cips.cardano.org/cips/cip19/#shelleyaddresses
    if (headerByte >= 8) {
        return AddressType.Other;
    } else if (headerByte === 6) {
        return AddressType.Enterprise;
    } else if (headerByte % 2 === 0) {
        return AddressType.Wallet;
    } else {
        return AddressType.Script;
    }
};

const getDelegationAddressType = (headerByte: number): StakeAddressType => {
    if (headerByte === 2 || headerByte === 3) {
        return StakeAddressType.Script;
    }

    return StakeAddressType.Key;
};

export const buildPaymentAddressType = (address: string): AddressType => {
    const decoded = decodeAddress(address);
    if (!decoded) {
        return AddressType.Other;
    }

    const [c] = decoded;
    const parsedChar = parseInt(c);

    if (isNaN(parsedChar)) {
        if (['e', 'f'].includes(c)) {
            return AddressType.Reward;
        } else {
            return AddressType.Other;
        }
    }

    const addressType = getPaymentAddressType(parsedChar);
    return addressType;
};

export const buildStakeKey = (address: string): string | null => {
    try {
        const decoded = decodeAddress(address);
        if (!decoded || decoded.length !== 114) return null;

        const [c] = decoded;
        const parsedChar = parseInt(c);

        const isTestnet = address.startsWith('addr_test');
        const prefix = isTestnet ? 'stake_test' : 'stake';

        const delegationType = `${getDelegationAddressType(parsedChar)}${isTestnet ? '0' : '1'}`;

        // stake part of the address is the last 56 bytes
        const stakeAddressDecoded = delegationType + decoded.slice(decoded.length - 56);
        const stakeAddress = bech32.encode(
            prefix,
            bech32.toWords(Uint8Array.from(Buffer.from(stakeAddressDecoded, 'hex'))),
            54 + prefix.length
        );

        return stakeAddress;
    } catch (error: any) {
        Logger.log(`Error building stake key ${error.message}`);
        return null;
    }
};

export const getPaymentKeyHash = (address: string): string | null => {
    try {
        const decoded = decodeAddress(address);
        if (!decoded) {
            try {
                // Try Byron addresses
                const jsonAddress = decodeCborToJson({cborString: Buffer.from(bs58.decode(address)).toString('hex')});
                const innerAddress = decodeCborToJson({cborString: (jsonAddress[0].value as Buffer).toString('hex')});
                return (innerAddress[0] as Buffer).toString('hex').slice(2);
            }
            catch {
                return null;
            }
        }
        else {
            return decoded.slice(2, 58);
        }

    } catch (error: any) {
        Logger.log(`Error getting payment key ${error.message}`);
        return null;
    }
};

export const bech32FromHex = (hex: string, isTestnet = !IS_PRODUCTION, type: 'addr' | 'stake' | 'pool' | 'drep' | 'cc_hot' | 'cc_cold' = 'addr'): string => {
    const prefix = isTestnet && (type == 'addr' || type == 'stake') ? `${type}_test` : type;
    const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    const words = bech32.toWords(bytes);
    return bech32.encode(prefix, words, bytes.length * 2 + prefix.length);
};

export const bech32AddressFromHashes = (paymentHash: string, paymentHashType: 'key' | 'script' = 'key', stakeHash = '', stakeHashType: 'key' | 'script' = 'key', type: 'addr' | 'stake' = 'addr', isTestnet = !IS_PRODUCTION): string => {
    let headerByte = 0;
    if (!stakeHash) {headerByte += 6}
    else {
        if (stakeHashType == 'script') {headerByte += 2}
    }
    if (paymentHashType == 'script') {headerByte += 1}
    const hex = `${headerByte.toString(16)}${isTestnet ? 0 : 1}${paymentHash}${stakeHash}`;
    return bech32FromHex(hex, isTestnet, type);
};

export const buildHolderInfo = (addr: string): AddressDetails => {
    const addressType = buildPaymentAddressType(addr);
    const hash = decodeAddress(addr);
    const knownOwnerName = contractsRegistry.get(hash?.slice(2) || '');
    let stakeKey = null;

    if (addressType === AddressType.Wallet || addressType === AddressType.Script) {
        stakeKey = buildStakeKey(addr);
    }

    return {
        address: stakeKey ?? addr,
        type: addressType,
        knownOwnerName
    };
};

export const getDateStringFromSlot = (currentSlot: number): Date => {
    // TODO: Make this work for all networks
    //console.log(`preview slot date = ${new Date(currentSlot * 1000)}`)
    if (NETWORK == 'preview') {
        return new Date((1666656000 + currentSlot) * 1000);
    }
    if (NETWORK == 'preprod') {
        return new Date((1654041600 + currentSlot) * 1000);
    }
    return new Date((1596491091 + (currentSlot - 4924800)) * 1000);
};

export const getSlotNumberFromDate = (date: Date): number => {
    if (NETWORK == 'preview') {
        return Math.floor(date.getTime() / 1000) - 1666656000;
    }
    if (NETWORK == 'preprod') {
        return Math.floor(date.getTime() / 1000) - 1654041600;
    }
    // Ignore parens to show intent
    // prettier-ignore
    return (Math.floor(date.getTime() / 1000) - 1596491091) + 4924800;
};

export const blake2b = (input: string | Buffer | Uint8Array, outlen = 32) => {
    if (typeof input == 'string') {
        input = Buffer.from(input, 'hex');
    }
    if (input instanceof Buffer) {
        input = new Uint8Array(input);
    }
    
    return blake2bHex(input, undefined, outlen)
}