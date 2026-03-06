import { decryptKmsCiphertext, hydrateKmsEnvironment, loadAfterHydratingKmsEnvironment } from './kmsEnvironment';

describe('kmsEnvironment', () => {
    it('hydrates missing environment values from matching *_ENC keys', async () => {
        const send = jest.fn().mockResolvedValue({
            Plaintext: Buffer.from('decoded-secret'),
        });
        const env = {
            API_KEY_ENC: Buffer.from('ciphertext').toString('base64'),
        } as NodeJS.ProcessEnv;

        const hydrated = await hydrateKmsEnvironment({
            env,
            client: { send } as any,
        });

        expect(hydrated).toEqual(['API_KEY']);
        expect(env.API_KEY).toBe('decoded-secret');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('hydrates missing environment values from KMS_ENV_BUNDLE_ENC before individual keys', async () => {
        const send = jest.fn().mockResolvedValueOnce({
            Plaintext: Buffer.from(JSON.stringify({ API_KEY: 'bundle-secret', OTHER_KEY: 'other-secret' })),
        });
        const env = {
            KMS_ENV_BUNDLE_ENC: Buffer.from('ciphertext').toString('base64'),
            API_KEY_ENC: Buffer.from('ignored').toString('base64'),
        } as NodeJS.ProcessEnv;

        const hydrated = await hydrateKmsEnvironment({
            env,
            client: { send } as any,
        });

        expect(hydrated).toEqual(['API_KEY', 'OTHER_KEY']);
        expect(env.API_KEY).toBe('bundle-secret');
        expect(env.OTHER_KEY).toBe('other-secret');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('leaves existing plaintext values alone', async () => {
        const send = jest.fn();
        const env = {
            API_KEY: 'already-set',
            API_KEY_ENC: Buffer.from('ciphertext').toString('base64'),
        } as NodeJS.ProcessEnv;

        const hydrated = await hydrateKmsEnvironment({
            env,
            client: { send } as any,
        });

        expect(hydrated).toEqual([]);
        expect(env.API_KEY).toBe('already-set');
        expect(send).not.toHaveBeenCalled();
    });

    it('fails when the bundle plaintext is not a JSON object', async () => {
        const send = jest.fn().mockResolvedValue({
            Plaintext: Buffer.from('not-json'),
        });

        await expect(
            hydrateKmsEnvironment({
                env: {
                    KMS_ENV_BUNDLE_ENC: Buffer.from('ciphertext').toString('base64'),
                } as NodeJS.ProcessEnv,
                client: { send } as any,
            }),
        ).rejects.toThrow('KMS env bundle plaintext must be a JSON object');
    });

    it('fails when KMS does not return plaintext bytes', async () => {
        const send = jest.fn().mockResolvedValue({});

        await expect(
            decryptKmsCiphertext(
                Buffer.from('ciphertext').toString('base64'),
                { send } as any,
            ),
        ).rejects.toThrow('KMS decrypt returned empty plaintext');
    });

    it('loads the target module after hydrating missing plaintext values', async () => {
        const send = jest.fn().mockResolvedValue({
            Plaintext: Buffer.from('decoded-secret'),
        });
        const env = {
            API_KEY_ENC: Buffer.from('ciphertext').toString('base64'),
        } as NodeJS.ProcessEnv;

        const loaded = await loadAfterHydratingKmsEnvironment(
            async () => ({ apiKey: env.API_KEY }),
            {
                env,
                client: { send } as any,
            },
        );

        expect(loaded).toEqual({ apiKey: 'decoded-secret' });
        expect(send).toHaveBeenCalledTimes(1);
    });
});
