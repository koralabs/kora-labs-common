import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';

export type KmsClientLike = Pick<KMSClient, 'send'>;
const KMS_ENV_BUNDLE_KEY = 'KMS_ENV_BUNDLE_ENC';
const KMS_DISABLED_KEY = 'KORA_KMS_DISABLED';

/**
 * True when AWS KMS is intentionally disabled. On the self-hosted deployment there is no
 * KMS — the environment is decrypted at DEPLOY time by SOPS/age (the bootstrap) and handed
 * to the process as plaintext, so there is nothing to decrypt at runtime. Set
 * KORA_KMS_DISABLED=true there. Legacy AWS deploys leave it unset and keep using KMS.
 */
export const isKmsDisabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
    env[KMS_DISABLED_KEY] === 'true' || env[KMS_DISABLED_KEY] === '1';

export async function decryptKmsCiphertext(
    ciphertext: string,
    client: KmsClientLike = new KMSClient({}),
): Promise<string> {
    const response = await client.send(
        new DecryptCommand({
            CiphertextBlob: Buffer.from(ciphertext, 'base64')
        }),
    );
    if (!response.Plaintext) {
        throw new Error('KMS decrypt returned empty plaintext');
    }
    return Buffer.from(response.Plaintext).toString('utf8');
}

export async function hydrateKmsEnvironment({
    env = process.env,
    client,
    keys
}: {
    env?: NodeJS.ProcessEnv;
    client?: KmsClientLike;
    keys?: string[];
} = {}): Promise<string[]> {
    // Self-host: SOPS/age decrypts the env at deploy time, so the values are already
    // plaintext and there is no KMS to call. Skip decryption entirely (don't even
    // construct a KMS client). Warn — but don't fail — if a *_ENC ciphertext (or the
    // bundle) is present without its plaintext counterpart: that means an encrypted value
    // was left in the env instead of supplying the decrypted one via SOPS.
    if (isKmsDisabled(env)) {
        const undecrypted = [
            ...(env[KMS_ENV_BUNDLE_KEY] ? [KMS_ENV_BUNDLE_KEY] : []),
            ...Object.keys(env).filter(
                (k) => k.endsWith('_ENC') && k !== KMS_ENV_BUNDLE_KEY && !env[k.slice(0, -4)]
            )
        ];
        if (undecrypted.length) {
            // eslint-disable-next-line no-console
            console.warn(
                `[kmsEnvironment] ${KMS_DISABLED_KEY} set — skipping AWS KMS; supply decrypted ` +
                `values via SOPS at deploy. Left undecrypted: ${undecrypted.join(', ')}`
            );
        }
        return [];
    }

    const hydratedKeys: string[] = [];
    const kms = client ?? new KMSClient({});
    const bundleCiphertext = env[KMS_ENV_BUNDLE_KEY];

    if (bundleCiphertext) {
        const plaintext = await decryptKmsCiphertext(bundleCiphertext, kms);
        let bundle: unknown;
        try {
            bundle = JSON.parse(plaintext);
        } catch {
            throw new Error('KMS env bundle plaintext must be a JSON object');
        }

        if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
            throw new Error('KMS env bundle plaintext must be a JSON object');
        }

        for (const key of Object.keys(bundle as Record<string, unknown>).sort()) {
            if (env[key]) {
                continue;
            }
            const value = (bundle as Record<string, unknown>)[key];
            if (typeof value !== 'string') {
                throw new Error(`KMS env bundle value for ${key} must be a string`);
            }
            env[key] = value;
            hydratedKeys.push(key);
        }
    }

    const candidateKeys = (keys ?? Object.keys(env)
        .filter((key) => key.endsWith('_ENC') && key !== KMS_ENV_BUNDLE_KEY)
        .map((key) => key.slice(0, -4))).sort();

    for (const key of candidateKeys) {
        if (env[key]) {
            continue;
        }
        const ciphertext = env[`${key}_ENC`];
        if (!ciphertext) {
            continue;
        }
        env[key] = await decryptKmsCiphertext(ciphertext, kms);
        hydratedKeys.push(key);
    }

    return hydratedKeys;
}

export async function loadAfterHydratingKmsEnvironment<T>(
    load: () => Promise<T>,
    options?: {
        env?: NodeJS.ProcessEnv;
        client?: KmsClientLike;
        keys?: string[];
    },
): Promise<T> {
    await hydrateKmsEnvironment(options);
    return load();
}
