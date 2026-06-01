import { generateKeyPairSync } from 'crypto';
import { signRs256, verifyRs256, isLocalJwtSigner } from './jwtSigner';

describe('jwtSigner (local RS256, KMS fallback)', () => {
    const ORIG = {
        priv: process.env.JWT_PRIVATE_KEY,
        pub: process.env.JWT_PUBLIC_KEY,
        keyId: process.env.JWT_KEY_ID
    };
    afterEach(() => {
        process.env.JWT_PRIVATE_KEY = ORIG.priv;
        process.env.JWT_PUBLIC_KEY = ORIG.pub;
        process.env.JWT_KEY_ID = ORIG.keyId;
    });

    it('signs and verifies with a local RSA private key (no AWS)', async () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        delete process.env.JWT_PUBLIC_KEY;
        delete process.env.JWT_KEY_ID;

        expect(isLocalJwtSigner()).toBe(true);
        const msg = Buffer.from('header.payload', 'utf-8');
        const sig = await signRs256(msg);
        expect(await verifyRs256(msg, sig)).toBe(true);
        expect(await verifyRs256(Buffer.from('header.tampered', 'utf-8'), sig)).toBe(false);
    });

    it('accepts a base64-encoded PEM private key', async () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        process.env.JWT_PRIVATE_KEY = Buffer.from(pem, 'utf-8').toString('base64');
        delete process.env.JWT_PUBLIC_KEY;
        delete process.env.JWT_KEY_ID;

        const msg = Buffer.from('a.b', 'utf-8');
        expect(await verifyRs256(msg, await signRs256(msg))).toBe(true);
    });

    it('falls back to requiring JWT_KEY_ID when no local key is configured', async () => {
        delete process.env.JWT_PRIVATE_KEY;
        delete process.env.JWT_PUBLIC_KEY;
        delete process.env.JWT_KEY_ID;
        expect(isLocalJwtSigner()).toBe(false);
        await expect(signRs256(Buffer.from('x'))).rejects.toThrow('JWT_KEY_ID not configured');
        await expect(verifyRs256(Buffer.from('x'), Buffer.from('y'))).rejects.toThrow('JWT_KEY_ID not configured');
    });
});
