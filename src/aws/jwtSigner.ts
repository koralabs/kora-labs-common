import { KMSClient, SignCommand, VerifyCommand } from '@aws-sdk/client-kms';
import { createSign, createVerify, createPublicKey } from 'crypto';

// RS256 (RSASSA_PKCS1_V1_5_SHA_256) sign/verify primitive shared by the JWT-issuing/
// verifying services (auth.handle.me grant cookie, handle.me/minting session tokens).
//
// It PREFERS a LOCAL RSA key — for the self-hosted deployment with no AWS — and FALLS
// BACK to AWS KMS (JWT_KEY_ID) when no local key is configured, so existing KMS-backed
// deployments keep working byte-for-byte and adoption can be gradual.
//
//   JWT_PRIVATE_KEY  RSA private key (PEM, or base64-encoded PEM) — used to SIGN. The
//                    public half is derived from it for verification, so a single shared
//                    secret (the private key) is enough on every node.
//   JWT_PUBLIC_KEY   (optional) RSA public key (PEM/base64) for verify-only nodes that
//                    should not hold the private key.
//   JWT_KEY_ID       AWS KMS key id/alias (legacy fallback when no local key is set).
//
// These callers sign/verify over different bytes (auth signs the payload only; the
// session-token path signs `header.payload`), so this stays a low-level bytes-in/bytes-out
// primitive — each service keeps building its own token exactly as before.

const SIGNING_ALGORITHM = 'RSASSA_PKCS1_V1_5_SHA_256';

let _kms: KMSClient | undefined;
const kms = (): KMSClient => (_kms ??= new KMSClient({}));

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

/** True when a local RSA key is configured (i.e. signing/verifying needs no AWS). */
export const isLocalJwtSigner = (): boolean => !!localPrivateKey() || !!pemFromEnv(process.env.JWT_PUBLIC_KEY);

/** Sign `message` with RS256 — local private key if present, else AWS KMS. */
export const signRs256 = async (message: Buffer): Promise<Buffer> => {
    const priv = localPrivateKey();
    if (priv) {
        const signer = createSign('RSA-SHA256');
        signer.update(message);
        signer.end();
        return signer.sign(priv);
    }
    const keyId = process.env.JWT_KEY_ID;
    if (!keyId) throw new Error('JWT_KEY_ID not configured');
    const response = await kms().send(
        new SignCommand({
            KeyId: keyId,
            Message: new Uint8Array(message),
            MessageType: 'RAW',
            SigningAlgorithm: SIGNING_ALGORITHM
        })
    );
    if (!response.Signature) throw new Error('KMS sign returned no signature');
    return Buffer.from(response.Signature);
};

/** Verify an RS256 `signature` over `message` — local public key if present, else AWS KMS. */
export const verifyRs256 = async (message: Buffer, signature: Buffer): Promise<boolean> => {
    const pub = localPublicKey();
    if (pub) {
        const verifier = createVerify('RSA-SHA256');
        verifier.update(message);
        verifier.end();
        return verifier.verify(pub, signature);
    }
    const keyId = process.env.JWT_KEY_ID;
    if (!keyId) throw new Error('JWT_KEY_ID not configured');
    const response = await kms().send(
        new VerifyCommand({
            KeyId: keyId,
            Message: new Uint8Array(message),
            MessageType: 'RAW',
            Signature: new Uint8Array(signature),
            SigningAlgorithm: SIGNING_ALGORITHM
        })
    );
    return !!response.SignatureValid;
};
