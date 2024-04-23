export enum CardanoNetwork {
    MAINNET = 'MAINNET',
    PREPROD = 'PREPROD',
    PREVIEW = 'PREVIEW',
    UNSET = 'UNSET'
}

export enum Cip67Label {
    LBL_000 = '00000000',
    LBL_001 = '00001070',
    LBL_002 = '000020E0',
    LBL_100 = '000643B0',
    LBL_222 = '000de140',
    LBL_444 = '001BC280',
}

export const IS_PRODUCTION = process.env.NODE_ENV?.trim() === 'production' && process.env.NETWORK?.toLowerCase() == 'mainnet';
export const IS_SERVER = (typeof process !== 'undefined') && (typeof process.versions.node !== 'undefined');