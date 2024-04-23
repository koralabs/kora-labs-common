import { IS_SERVER } from '../../constants';

// var verifier = await getRandomCodeVerifier(64);
// var challenge = await getChallengeFromVerifier(verifier);

export const getNativeCrypto = async () => {
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
    // @ts-expect-error -> getRandomValues is indeed callable
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