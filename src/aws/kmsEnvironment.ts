import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';

export type KmsClientLike = Pick<KMSClient, 'send'>;
const KMS_ENV_BUNDLE_KEY = 'KMS_ENV_BUNDLE_ENC';

export async function decryptKmsCiphertext(
    ciphertext: string,
    client: KmsClientLike = new KMSClient({}),
): Promise<string> {
    const response = await client.send(
        new DecryptCommand({
            CiphertextBlob: Buffer.from(ciphertext, 'base64'),
        }),
    );
    if (!response.Plaintext) {
        throw new Error('KMS decrypt returned empty plaintext');
    }
    return Buffer.from(response.Plaintext).toString('utf8');
}

export async function hydrateKmsEnvironment({
    env = process.env,
    client = new KMSClient({}),
    keys,
}: {
    env?: NodeJS.ProcessEnv;
    client?: KmsClientLike;
    keys?: string[];
} = {}): Promise<string[]> {
    const hydratedKeys: string[] = [];
    const bundleCiphertext = env[KMS_ENV_BUNDLE_KEY];

    if (bundleCiphertext) {
        const plaintext = await decryptKmsCiphertext(bundleCiphertext, client);
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
        env[key] = await decryptKmsCiphertext(ciphertext, client);
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
