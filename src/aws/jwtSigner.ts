import { createSign, createVerify, createPrivateKey, createPublicKey } from 'crypto';

// RS256 (RSASSA-PKCS1-v1_5 / SHA-256) sign/verify primitive shared by the JWT-issuing/verifying
// services. Keys are LOCAL RSA keys only; AWS KMS signing was retired.
//
//   JWT_PRIVATE_KEY  RSA private key (PEM, or base64-encoded PEM) — required to SIGN. The public half
//                    is derived from it, so a node holding the private key can also verify.
//   JWT_PUBLIC_KEY   (optional) RSA public key (PEM/base64) for verify-only nodes.
//
// JWT_KEY_ID is no longer read. Call assertJwtKeysConfigured() at startup so a missing or invalid
// key fails the service before it accepts traffic, not on the first token.

// Accept a raw PEM or a base64-encoded PEM (single-line, env-friendly).
const pemFromEnv = (value?: string): string | undefined => {
    if (!value) return undefined;
    if (value.includes('-----BEGIN')) return value;
    try {
        const decoded = Buffer.from(value, 'base64').toString('utf-8');
        return decoded.includes('-----BEGIN') ? decoded : undefined;
    } catch {
        return undefined;
    }
};

const localPrivateKey = (): string | undefined => pemFromEnv(process.env.JWT_PRIVATE_KEY);
const localPublicKey = (): string | undefined => {
    const pub = pemFromEnv(process.env.JWT_PUBLIC_KEY);
    if (pub) return pub;
    const priv = localPrivateKey();
    if (!priv) return undefined;
    return createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
};

/** True when a local RSA key is configured. */
export const isLocalJwtSigner = (): boolean => !!localPrivateKey() || !!pemFromEnv(process.env.JWT_PUBLIC_KEY);

/**
 * Startup check: the required key must exist and be a cryptographically valid RSA key.
 * `sign` (default) needs JWT_PRIVATE_KEY; `verify` accepts JWT_PUBLIC_KEY or JWT_PRIVATE_KEY.
 */
export const assertJwtKeysConfigured = ({ mode = 'sign' }: { mode?: 'sign' | 'verify' } = {}): void => {
    const priv = localPrivateKey();
    if (mode === 'sign') {
        if (!priv) throw new Error('JWT_PRIVATE_KEY not configured');
        if (createPrivateKey(priv).asymmetricKeyType !== 'rsa') throw new Error('JWT_PRIVATE_KEY must be an RSA key');
        return;
    }
    const pub = localPublicKey();
    if (!pub) throw new Error('JWT_PUBLIC_KEY or JWT_PRIVATE_KEY not configured');
    if (createPublicKey(pub).asymmetricKeyType !== 'rsa') throw new Error('JWT public key must be an RSA key');
};

/** Sign `message` with RS256 using the local private key. */
export const signRs256 = async (message: Buffer): Promise<Buffer> => {
    const priv = localPrivateKey();
    if (!priv) throw new Error('JWT_PRIVATE_KEY not configured');
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    return signer.sign(priv);
};

/** Verify an RS256 `signature` over `message` using the local public key (or the key derived from the private key). */
export const verifyRs256 = async (message: Buffer, signature: Buffer): Promise<boolean> => {
    const pub = localPublicKey();
    if (!pub) throw new Error('JWT_PUBLIC_KEY or JWT_PRIVATE_KEY not configured');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(message);
    verifier.end();
    return verifier.verify(pub, signature);
};
