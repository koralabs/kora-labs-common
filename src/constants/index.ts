export const IS_PRODUCTION = process.env.NODE_ENV?.trim() === 'production' && process.env.NETWORK?.toLowerCase() == 'mainnet';
export const IS_SERVER = (typeof process !== 'undefined') && (typeof process.versions.node !== 'undefined');
export const AUTH_GRANT_DURATION = 1000 * 60 * 60 * 24 * 30; // 30 days