import { hydrateKmsEnvironment, loadAfterHydratingKmsEnvironment } from './kmsEnvironment';

// Invariant: no KMS client is ever created and ciphertext settings are rejected, never silently ignored.
// Failure caught: a leftover *_ENC value would start the service with a missing secret instead of failing.
// Negative control: restoring the old "skip when disabled" or decrypt behaviour makes the rejection fail.
describe('retired KMS environment hydration', () => {
    it('returns no hydrated keys and leaves the environment untouched for plaintext settings', async () => {
        const env = { API_KEY: 'plain', OTHER: 'x' } as NodeJS.ProcessEnv;
        await expect(hydrateKmsEnvironment({ env })).resolves.toEqual([]);
        expect(env).toEqual({ API_KEY: 'plain', OTHER: 'x' });
    });

    it.each([{ KMS_ENV_BUNDLE_ENC: 'ciphertext' }, { API_KEY_ENC: 'ciphertext', API_KEY: 'plain' }])(
        'rejects encrypted settings: %j', async env => {
            await expect(hydrateKmsEnvironment({ env: env as NodeJS.ProcessEnv })).rejects.toThrow(/AWS KMS is retired.*_ENC/);
        }
    );

    it('ignores blank *_ENC settings and loads the module only after validation', async () => {
        const order: string[] = [];
        await expect(loadAfterHydratingKmsEnvironment(async () => { order.push('load'); return 7; }, { env: { A_ENC: '' } as NodeJS.ProcessEnv })).resolves.toBe(7);
        await expect(loadAfterHydratingKmsEnvironment(async () => { order.push('bad'); return 1; }, { env: { A_ENC: 'x' } as NodeJS.ProcessEnv })).rejects.toThrow();
        expect(order).toEqual(['load']);
    });
});
