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
