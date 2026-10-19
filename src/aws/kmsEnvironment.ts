// AWS KMS was retired. Environment values are decrypted at DEPLOY time (SOPS/age) and handed to the
// process as plaintext. These helpers remain only so existing startup call sites keep working: they
// verify that no KMS-encrypted setting is left in the environment, and never call AWS.
const KMS_ENV_BUNDLE_KEY = 'KMS_ENV_BUNDLE_ENC';

const encryptedSettingNames = (env: NodeJS.ProcessEnv): string[] => [
    ...(env[KMS_ENV_BUNDLE_KEY] ? [KMS_ENV_BUNDLE_KEY] : []),
    ...Object.keys(env).filter((key) => key.endsWith('_ENC') && key !== KMS_ENV_BUNDLE_KEY && env[key])
].sort();

/** Fail fast if an AWS KMS ciphertext setting is present; returns the (always empty) hydrated key list. */
export async function hydrateKmsEnvironment({ env = process.env }: { env?: NodeJS.ProcessEnv } = {}): Promise<string[]> {
    const encrypted = encryptedSettingNames(env);
    if (encrypted.length) {
        throw new Error(`AWS KMS is retired; supply decrypted values via SOPS at deploy. Encrypted settings found: ${encrypted.join(', ')}`);
    }
    return [];
}

export async function loadAfterHydratingKmsEnvironment<T>(load: () => Promise<T>, options?: { env?: NodeJS.ProcessEnv }): Promise<T> {
    await hydrateKmsEnvironment(options);
    return load();
}
