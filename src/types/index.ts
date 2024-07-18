export * from './gallery';

export type BoolInt = 0 | 1;
export type HexString = `0x${string}`;
export type HexStringOrEmpty = HexString | '';

export interface KeyPair {
    key: string;
    value: any;
}

/**
 * The Cip67Label is a string that is used to identify the asset type.
 * First, remove the first and last 0.
 * Next, use the first 4 characters as the hex and convert to decimal. https://www.rapidtables.com/convert/number/hex-to-decimal.html
 * Finally, use the decimal number and convert to CRC8. It should match the last 2 characters. https://crccalc.com/
 */
export enum AssetNameLabel {
    LBL_000 = '00000000',
    LBL_001 = '00001070',
    LBL_002 = '000020e0',
    LBL_100 = '000643b0',
    LBL_222 = '000de140',
    LBL_444 = '001bc280'
}

export enum CardanoNetwork {
    MAINNET = 'MAINNET',
    PREPROD = 'PREPROD',
    PREVIEW = 'PREVIEW',
    UNSET = 'UNSET'
}

export type Network = 'preview' | 'preprod' | 'mainnet';
