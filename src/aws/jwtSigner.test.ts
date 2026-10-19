import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { assertJwtKeysConfigured, isLocalJwtSigner, signRs256, verifyRs256 } from './jwtSigner';

const KEYS = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_KEY_ID'] as const;
const originalEnv = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (key: ReturnType<typeof rsa>['privateKey'] | ReturnType<typeof rsa>['publicKey'], type: 'pkcs8' | 'spki') =>
    key.export({ type, format: 'pem' }).toString();

beforeEach(() => { for (const key of KEYS) delete process.env[key]; });
afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value as string;
    }
});

describe('jwtSigner (local RS256 only)', () => {
    it.each(['pem', 'base64'])('signs and verifies with a %s private key, derived public key', async encoding => {
        const { privateKey } = rsa();
        const value = pem(privateKey, 'pkcs8');
        process.env.JWT_PRIVATE_KEY = encoding === 'pem' ? value : Buffer.from(value).toString('base64');
        const message = Buffer.from('header.payload');
        const signature = await signRs256(message);
        expect(isLocalJwtSigner()).toBe(true);
        expect(await verifyRs256(message, signature)).toBe(true);
        expect(await verifyRs256(Buffer.from('header.tampered'), signature)).toBe(false);
    });

    // Invariant: a verify-only node verifies with the public key but cannot sign.
    // Failure caught: verify-only nodes silently using another credential path to sign.
    // Negative control: tampered message returns false; missing private key rejects signing.
    it.each(['pem', 'base64'])('verifies with a %s public key and refuses to sign', async encoding => {
        const { privateKey, publicKey } = rsa();
        const value = pem(publicKey, 'spki');
        process.env.JWT_PUBLIC_KEY = encoding === 'pem' ? value : Buffer.from(value).toString('base64');
        const message = Buffer.from('header.payload');
        const signature = cryptoSign('RSA-SHA256', message, privateKey);
        expect(await verifyRs256(message, signature)).toBe(true);
        expect(await verifyRs256(Buffer.from('header.tampered'), signature)).toBe(false);
        await expect(signRs256(message)).rejects.toThrow('JWT_PRIVATE_KEY not configured');
    });

    // Invariant: no key means a clear local failure; JWT_KEY_ID is ignored and AWS is never contacted.
    // Failure caught: a retained KMS fallback would try the network (denied by the test guard) when a key id exists.
    // Negative control: reading JWT_KEY_ID again changes the error from the local configuration message.
    it('fails with local configuration errors and ignores JWT_KEY_ID', async () => {
        process.env.JWT_KEY_ID = 'alias/retired';
        expect(isLocalJwtSigner()).toBe(false);
        await expect(signRs256(Buffer.from('x'))).rejects.toThrow('JWT_PRIVATE_KEY not configured');
        await expect(verifyRs256(Buffer.from('x'), Buffer.from('y'))).rejects.toThrow('JWT_PUBLIC_KEY or JWT_PRIVATE_KEY not configured');
        expect(() => assertJwtKeysConfigured()).toThrow('JWT_PRIVATE_KEY not configured');
        expect(() => assertJwtKeysConfigured({ mode: 'verify' })).toThrow('JWT_PUBLIC_KEY or JWT_PRIVATE_KEY not configured');
    });

    // Invariant: startup validation rejects invalid (not just absent) keys, and accepts valid ones per mode.
    // Failure caught: a corrupt PEM passes configuration then fails the first real request.
    // Negative control: skipping createPrivateKey/createPublicKey makes the invalid cases pass silently.
    it('startup assertion validates sign and verify keys cryptographically', () => {
        process.env.JWT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nbogus\n-----END PRIVATE KEY-----';
        expect(() => assertJwtKeysConfigured()).toThrow();
        const { privateKey, publicKey } = rsa();
        process.env.JWT_PRIVATE_KEY = pem(privateKey, 'pkcs8');
        expect(() => assertJwtKeysConfigured()).not.toThrow();
        expect(() => assertJwtKeysConfigured({ mode: 'verify' })).not.toThrow();
        delete process.env.JWT_PRIVATE_KEY;
        process.env.JWT_PUBLIC_KEY = pem(publicKey, 'spki');
        expect(() => assertJwtKeysConfigured({ mode: 'verify' })).not.toThrow();
        expect(() => assertJwtKeysConfigured()).toThrow('JWT_PRIVATE_KEY not configured');
    });
});
