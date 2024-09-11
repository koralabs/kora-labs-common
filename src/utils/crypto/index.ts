import { IS_SERVER, IS_PRODUCTION, NETWORK } from '../../constants';
import { AddressDetails, AddressType, AssetNameLabel, StakeAddressType } from '../../types';
import { decodeCborToJson } from '../cbor';
import { Logger} from '../../logger'
import { bech32 } from 'bech32';
import bs58 from 'bs58';
import { crc8 } from 'crc';

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
    let str = "";
    const bytes = new Uint8Array(a);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
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

export const parseAssetNameLabel = (assetName: string): AssetNameLabel | null => {
    for(const lbl in AssetNameLabel) {
        if (assetName.startsWith(AssetNameLabel[lbl as keyof typeof AssetNameLabel])) {
            return lbl as AssetNameLabel;
        }
    }
    return null;
}

export const checkNameLabel = (assetName: string) => {
    const assetNameString = typeof assetName === 'string' ? assetName : new TextDecoder().decode(assetName);
    let isCip67 = false;
    let assetLabel = null;
    let actualAssetName = Buffer.from(assetName, 'hex').toString('utf8');
    if (assetNameString.length >= 8) {
        const maybeAssetLabel = assetNameString.slice(0, 8);
        if (maybeAssetLabel.startsWith('0') && maybeAssetLabel.endsWith('0')) {
            const label = maybeAssetLabel.slice(1, 5);
            const check = maybeAssetLabel.slice(5, 7);
            if (crc8(Buffer.from(label, 'hex')).toString(16).padStart(2, '0') == check) {
                isCip67 = true;
                assetLabel = `${parseInt(label, 16).toString().padStart(3, '0')}`;
                actualAssetName = Buffer.from(assetName.slice(8), 'hex').toString('utf8');
            }
        }
    }
    return {
        isCip67,
        assetLabel,
        assetName: actualAssetName
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

export const getPaymentKeyHash = async (address: string): Promise<string | null> => {
    try {
        const decoded = decodeAddress(address);
        if (!decoded) {
            try {
                // Try Byron addresses
                const jsonAddress = await decodeCborToJson({cborString: Buffer.from(bs58.decode(address)).toString('hex')});
                const innerAddress = await decodeCborToJson({cborString: (jsonAddress[0].value as Buffer).toString('hex')});
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

export const bech32FromHex = (hex: string, isTestnet = !IS_PRODUCTION, type: 'addr' | 'stake' | 'pool' | 'drep' = 'addr'): string => {
    const prefix = isTestnet ? `${type}_test` : type;
    const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    const words = bech32.toWords(bytes);
    return bech32.encode(prefix, words, bytes.length * 2 + prefix.length);
};

export const getAddressHolderDetails = (addr: string): AddressDetails => {
    const addressType = buildPaymentAddressType(addr);
    let knownOwnerName = checkKnownSmartContracts(addr);
    let stakeKey = null;

    if (addressType === AddressType.Wallet || addressType === AddressType.Script) {
        stakeKey = buildStakeKey(addr);
        knownOwnerName = checkKnownSmartContracts(addr, stakeKey);
    }

    return {
        address: stakeKey ?? addr,
        type: addressType,
        knownOwnerName
    };
};

export const checkKnownSmartContracts = (address: string, stake?: string | null): string => {
    switch (address) {
        case 'addr1w999n67e86jn6xal07pzxtrmqynspgx0fwmcmpua4wc6yzsxpljz3':
            return 'jpg.store';
        case 'addr1w9yr0zr530tp9yzrhly8lw5upddu0eym3yh0mjwa0qlr9pgmkzgv0':
        case 'addr1w89s3lfv7gkugker5llecq6x3k2vjvfnvp4692laeqe6w6s93vj3j':
        case 'addr1wx38kptjhuurcag7zdvh5cq98rjxt0ulf6ed7jtmz5gpkfcgjyyx3':
            return 'cnft.io';
        case 'addr1wyd3phmr5lhv3zssawqjdpnqrm5r5kgppmmf7864p3dvdrqwuutk4':
            return 'epoch.art';
        case 'addr1wxkqxmfkt6jas8mul0luqea8c5vsg8reu3ak3v9cswmm6yg2u9mrh':
            return 'freeroam.io';
        case 'addr1wxx0w0ku3jz8hz5dakg982lh22xx6q7z2z7vh0dt34uzghqrxdhqq':
            return 'Cardahub.io';
        case 'addr1wywukn5q6lxsa5uymffh2esuk8s8fel7a0tna63rdntgrysv0f3ms':
            return 'Artifct';
        case 'addr1wxz62xuzeujtuuzn2ewkrzwmm2pf79kfc84lrnjsd9ja2jscv3gy0':
            return 'Genesis House';
        case 'addr1wydpsqf5zz9ddy76d3f3jrrf6jkpyjr48nx5a706w9y68ucy4wu6s':
            return 'Yummi-Staking';
        case 'addr1wyl5fauf4m4thqze74kvxk8efcj4n7qjx005v33ympj7uwsscprfk':
            return 'Tokhun';
        case 'stake1uxqh9rn76n8nynsnyvf4ulndjv0srcc8jtvumut3989cqmgjt49h6':
            return 'jpg.store';
    }

    switch (stake) {
        case 'stake1uxqh9rn76n8nynsnyvf4ulndjv0srcc8jtvumut3989cqmgjt49h6':
            return 'jpg.store';
    }

    return '';
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