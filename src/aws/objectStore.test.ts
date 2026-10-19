import { isR2ObjectStore, objectStoreConfig } from './objectStore';

const R2_ENV: NodeJS.ProcessEnv = {
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'r2-key',
    R2_SECRET_ACCESS_KEY: 'r2-secret'
};

// Invariant: absent/partial R2 configuration fails before any SDK can select an AWS endpoint or credentials.
// Failure caught: deleting R2 settings silently selects ambient AWS S3 after its buckets were retired.
// Negative control: restoring the old region-only default makes the missing-settings assertions fail.
describe('R2-only object store', () => {
    it.each([{}, { AWS_REGION: 'us-west-2' }, { R2_ENDPOINT: R2_ENV.R2_ENDPOINT },
        { ...R2_ENV, R2_ACCESS_KEY_ID: undefined }, { ...R2_ENV, R2_SECRET_ACCESS_KEY: '' }])(
        'rejects missing required R2 settings: %j', env => {
            expect(() => objectStoreConfig(env)).toThrow(/R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/);
            expect(() => isR2ObjectStore(env)).toThrow(/R2_/);
        }
    );

    // Invariant: AWS environment values never affect the explicitly configured R2 transport.
    // Failure caught: region/credential fallback changes a correctly configured R2 request to AWS.
    // Negative control: reading AWS_REGION or AWS credentials changes this exact config assertion.
    it('returns only the explicit R2 endpoint, auto region and R2 credentials', () => {
        expect(objectStoreConfig({ ...R2_ENV, AWS_REGION: 'us-west-2', AWS_ACCESS_KEY_ID: 'not-r2', AWS_SECRET_ACCESS_KEY: 'not-r2' })).toEqual({
            region: 'auto', endpoint: R2_ENV.R2_ENDPOINT,
            credentials: { accessKeyId: 'r2-key', secretAccessKey: 'r2-secret' }
        });
        expect(isR2ObjectStore(R2_ENV)).toBe(true);
        expect(objectStoreConfig({ ...R2_ENV, KORA_OBJECT_STORE: 'r2' })).toEqual(objectStoreConfig(R2_ENV));
    });

    // Invariant: an obsolete explicit S3 selector cannot bypass R2 validation or re-enable AWS.
    // Failure caught: a leftover deployment override silently revives the retired backend.
    // Negative control: restoring KORA_OBJECT_STORE=s3 selection returns a config instead of rejecting.
    it.each(['s3', 'unknown'])('rejects the unsupported provider selector %s', provider => {
        expect(() => objectStoreConfig({ ...R2_ENV, KORA_OBJECT_STORE: provider })).toThrow(/retired|only.*R2/i);
        expect(() => isR2ObjectStore({ ...R2_ENV, KORA_OBJECT_STORE: provider })).toThrow();
    });
});
