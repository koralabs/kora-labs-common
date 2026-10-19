// Cloudflare R2 uses the S3 protocol, not the retired AWS S3 service. Callers keep using
// S3Client/commands, but must construct their client during startup so missing R2 settings fail early.
// Required: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// KORA_OBJECT_STORE=r2 is accepted for compatibility; s3/other selectors are rejected.

/** Structural subset of S3ClientConfig; never permits SDK endpoint/credential discovery. */
export interface ObjectStoreConfig {
    region: 'auto';
    endpoint: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
}

/** Require the explicit R2 transport; there is no AWS region, endpoint or credential fallback. */
export const objectStoreConfig = (env: NodeJS.ProcessEnv = process.env): ObjectStoreConfig => {
    if (env.KORA_OBJECT_STORE && env.KORA_OBJECT_STORE !== 'r2') {
        throw new Error('AWS S3 is retired; only Cloudflare R2 is supported (remove KORA_OBJECT_STORE or set it to r2)');
    }
    const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    if (!R2_ENDPOINT?.trim() || !R2_ACCESS_KEY_ID?.trim() || !R2_SECRET_ACCESS_KEY?.trim()) {
        throw new Error('R2 object store requires R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to all be set before startup');
    }
    return {
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
    };
};

/** Compatibility predicate for existing bucket/ACL callers: validate configuration, then always R2. */
export const isR2ObjectStore = (env: NodeJS.ProcessEnv = process.env): boolean => {
    objectStoreConfig(env);
    return true;
};
