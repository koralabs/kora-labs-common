// Object-store config shim: swap AWS S3 <-> Cloudflare R2 behind one env-gated factory.
// Analogous to the KMS<->SOPS swap (kmsEnvironment) and the local-RS256 JWT shim (jwtSigner):
// a thin, shared, reversible seam so call sites don't bake in a provider.
//
// R2 is S3-API-compatible, so this returns an object assignable to @aws-sdk/client-s3's
// S3ClientConfig (region/endpoint/credentials) -- call sites keep using
//   `new S3Client(objectStoreConfig())`  + GetObjectCommand({ Bucket, Key })
// completely UNCHANGED. The bucket name and keys stay in the command, not here.
//
// REVERSIBILITY: with no R2 env set this returns exactly the previous AWS S3 config
// ({ region: AWS_REGION ?? 'us-east-1' }), so the AWS/Lambda code path is untouched and
// "go back to S3" is simply "don't set R2_ENDPOINT" -- no code change.
//
// Env contract:
//   R2_ENDPOINT           https://<account>.r2.cloudflarestorage.com  (presence selects R2)
//   R2_ACCESS_KEY_ID      R2 S3 access key id
//   R2_SECRET_ACCESS_KEY  R2 S3 secret access key
//   KORA_OBJECT_STORE     optional explicit override: 's3' | 'r2'
//   AWS_REGION            S3 region (default 'us-east-1') in S3 mode

// Structural subset of @aws-sdk/client-s3's S3ClientConfig -- kept inline so this package
// adds NO new dependency. `new S3Client(objectStoreConfig())` type-checks because every field
// here is an optional, compatible field of S3ClientConfig.
export interface ObjectStoreConfig {
    region: string;
    endpoint?: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** True when the object store should be Cloudflare R2 rather than AWS S3. */
export const isR2ObjectStore = (env: NodeJS.ProcessEnv = process.env): boolean => {
    if (env.KORA_OBJECT_STORE === 'r2') return true;
    if (env.KORA_OBJECT_STORE === 's3') return false;
    return !!env.R2_ENDPOINT;
};

/**
 * S3-client config for the active object store; pass straight into `new S3Client(...)`.
 * Returns R2 config when R2 is selected (R2_ENDPOINT or KORA_OBJECT_STORE=r2), otherwise the
 * unchanged AWS S3 config. Throws if R2 is selected without complete R2 credentials.
 */
export const objectStoreConfig = (env: NodeJS.ProcessEnv = process.env): ObjectStoreConfig => {
    if (isR2ObjectStore(env)) {
        const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
        if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
            throw new Error(
                'R2 object store selected but R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set'
            );
        }
        return {
            region: 'auto',
            endpoint: R2_ENDPOINT,
            credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
        };
    }
    return { region: env.AWS_REGION ?? 'us-east-1' };
};
