import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';

export type KmsClientLike = Pick<KMSClient, 'send'>;

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
    const candidateKeys = (keys ?? Object.keys(env)
        .filter((key) => key.endsWith('_ENC'))
        .map((key) => key.slice(0, -4))).sort();
    const hydratedKeys: string[] = [];

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
