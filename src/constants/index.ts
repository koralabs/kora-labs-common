import { mintedOgList } from './mintedOgList';

export const IS_SERVER = typeof process !== 'undefined' && typeof process.versions.node !== 'undefined';
export const NETWORK = process.env.NETWORK?.toLowerCase() ?? 'preview';
export const IS_PRODUCTION = IS_SERVER
    ? process.env.NODE_ENV?.trim() === 'production' && NETWORK == 'mainnet'
    : !(
        window.location.host.includes('preview.') ||
          window.location.host.includes('preprod.') ||
          window.location.host.includes('localhost')
    );
export const AUTH_GRANT_DURATION = 1000 * 60 * 60 * 24 * 30; // 30 days
export const TOU_URL = 'https://handle.me/$/tou';
export const MINTED_OG_LIST = mintedOgList;