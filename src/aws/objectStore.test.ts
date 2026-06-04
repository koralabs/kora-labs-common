import { isR2ObjectStore, objectStoreConfig } from './objectStore';

const R2_ENV = {
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'akid',
    R2_SECRET_ACCESS_KEY: 'secret'
} as NodeJS.ProcessEnv;

describe('objectStore', () => {
    it('defaults to AWS S3 (us-east-1) with no R2 env', () => {
        expect(isR2ObjectStore({} as NodeJS.ProcessEnv)).toBe(false);
        expect(objectStoreConfig({} as NodeJS.ProcessEnv)).toEqual({ region: 'us-east-1' });
    });

    it('honors AWS_REGION in S3 mode', () => {
        expect(objectStoreConfig({ AWS_REGION: 'us-west-2' } as NodeJS.ProcessEnv)).toEqual({ region: 'us-west-2' });
    });

    it('selects R2 when R2_ENDPOINT is set and returns R2 config', () => {
        expect(isR2ObjectStore(R2_ENV)).toBe(true);
        expect(objectStoreConfig(R2_ENV)).toEqual({
            region: 'auto',
            endpoint: 'https://acct.r2.cloudflarestorage.com',
            credentials: { accessKeyId: 'akid', secretAccessKey: 'secret' }
        });
    });

    it('throws if R2 selected but credentials incomplete', () => {
        expect(() =>
            objectStoreConfig({ R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com' } as NodeJS.ProcessEnv)
        ).toThrow(/R2_ACCESS_KEY_ID/);
    });

    it('KORA_OBJECT_STORE=s3 forces S3 even when R2_ENDPOINT is present', () => {
        const env = { ...R2_ENV, KORA_OBJECT_STORE: 's3' } as NodeJS.ProcessEnv;
        expect(isR2ObjectStore(env)).toBe(false);
        expect(objectStoreConfig(env)).toEqual({ region: 'us-east-1' });
    });

    it('KORA_OBJECT_STORE=r2 selects R2 mode explicitly', () => {
        expect(isR2ObjectStore({ ...R2_ENV, KORA_OBJECT_STORE: 'r2' } as NodeJS.ProcessEnv)).toBe(true);
    });
});
