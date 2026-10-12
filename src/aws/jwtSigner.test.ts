import { KMSClient, SignCommand, VerifyCommand } from '@aws-sdk/client-kms';
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'crypto';
import { signRs256, verifyRs256, isLocalJwtSigner } from './jwtSigner';

describe('jwtSigner (local RS256, KMS fallback)', () => {
    const originalEnv = {
        JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
        JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
        JWT_KEY_ID: process.env.JWT_KEY_ID
    };
    let kmsSend: jest.SpiedFunction<KMSClient['send']>;

    beforeEach(() => {
        delete process.env.JWT_PRIVATE_KEY;
        delete process.env.JWT_PUBLIC_KEY;
        delete process.env.JWT_KEY_ID;
        kmsSend = jest.spyOn(KMSClient.prototype, 'send').mockImplementation(async () => {
            throw new Error('Unexpected AWS KMS request');
        });
    });

    afterEach(() => {
        kmsSend.mockRestore();
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
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
        expect(kmsSend).not.toHaveBeenCalled();
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

    // Verify-only nodes accept PEM or base64 public keys and reject tampered bytes.
    // Ignoring JWT_PUBLIC_KEY fails verification; changing the message is the negative control.
    it.each(['pem', 'base64'])('verifies with a %s public key without a private key', async (encoding) => {
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        process.env.JWT_PUBLIC_KEY = encoding === 'pem' ? pem : Buffer.from(pem).toString('base64');
        const message = Buffer.from('header.payload');
        const signature = cryptoSign('RSA-SHA256', message, privateKey);

        expect(isLocalJwtSigner()).toBe(true);
        expect(await verifyRs256(message, signature)).toBe(true);
        expect(await verifyRs256(Buffer.from('header.tampered'), signature)).toBe(false);
        await expect(signRs256(message)).rejects.toThrow('JWT_KEY_ID not configured');
        expect(kmsSend).not.toHaveBeenCalled();
    });

    // KMS signing returns an RS256 Buffer over the caller's exact bytes.
    // Wrong request fields fail the boundary assertions; tampered bytes fail real verification.
    it('signs through KMS with the configured key and raw RS256 message', async () => {
        process.env.JWT_KEY_ID = 'alias/jwt-tests';
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const message = Buffer.from([0, 255, 65, 128]);
        kmsSend.mockImplementation(async (command) => {
            if (!(command instanceof SignCommand)) throw new Error('Expected a KMS SignCommand');
            expect(command.input).toEqual({
                KeyId: 'alias/jwt-tests',
                Message: new Uint8Array(message),
                MessageType: 'RAW',
                SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
            });
            if (!command.input.Message) throw new Error('Expected signing bytes');
            return {
                $metadata: {},
                Signature: new Uint8Array(cryptoSign('RSA-SHA256', Buffer.from(command.input.Message), privateKey))
            };
        });

        expect(isLocalJwtSigner()).toBe(false);
        const signature = await signRs256(message);
        expect(Buffer.isBuffer(signature)).toBe(true);
        expect(signature).toEqual(cryptoSign('RSA-SHA256', message, privateKey));
        expect(cryptoVerify('RSA-SHA256', message, publicKey, signature)).toBe(true);
        expect(cryptoVerify('RSA-SHA256', Buffer.from([0, 255, 65, 129]), publicKey, signature)).toBe(false);
        expect(kmsSend).toHaveBeenCalledTimes(1);
    });

    // A KMS response without a signature must reject rather than issue a token.
    // Returning an empty or default signature would fail the rejection assertion.
    it('rejects when KMS signing returns no signature', async () => {
        process.env.JWT_KEY_ID = 'alias/jwt-tests';
        kmsSend.mockImplementation(async () => ({ $metadata: {} }));

        await expect(signRs256(Buffer.from('header.payload'))).rejects.toThrow('KMS sign returned no signature');
    });

    // KMS verification accepts a valid result, rejects false/absent results, and preserves request bytes.
    // Forcing success fails the false/absent cases; changing the request fails its contract assertions.
    it.each([
        { signatureValid: true, expected: true },
        { signatureValid: false, expected: false },
        { signatureValid: undefined, expected: false }
    ])('returns $expected when KMS SignatureValid is $signatureValid', async ({ signatureValid, expected }) => {
        process.env.JWT_KEY_ID = 'alias/jwt-tests';
        const message = Buffer.from([0, 255, 65, 128]);
        const signature = Buffer.from([255, 0, 128, 65]);
        kmsSend.mockImplementation(async () => ({ $metadata: {}, SignatureValid: signatureValid }));

        expect(await verifyRs256(message, signature)).toBe(expected);
        expect(kmsSend).toHaveBeenCalledTimes(1);
        const command = kmsSend.mock.calls[0][0];
        expect(command).toBeInstanceOf(VerifyCommand);
        expect((command as VerifyCommand).input).toEqual({
            KeyId: 'alias/jwt-tests',
            Message: new Uint8Array(message),
            MessageType: 'RAW',
            Signature: new Uint8Array(signature),
            SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
        });
    });

    // KMS outages reach callers so failed signing or verification cannot appear successful.
    // Swallowing or replacing the dependency rejection fails the original-error assertion.
    it.each(['sign', 'verify'] as const)('propagates KMS %s failures', async (operation) => {
        process.env.JWT_KEY_ID = 'alias/jwt-tests';
        const failure = new Error('KMS unavailable');
        kmsSend.mockImplementation(async () => {
            throw failure;
        });
        const message = Buffer.from('header.payload');
        const result = operation === 'sign' ? signRs256(message) : verifyRs256(message, Buffer.from('signature'));

        await expect(result).rejects.toBe(failure);
    });
});
