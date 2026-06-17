const ORIGINAL_ENV = { ...process.env };
const CONTROLLED_ENV_KEYS = [
    'AWS_REGION',
    'IS_LOCAL',
    'NETWORK',
    'NODE_ENV',
    'REDIS_HOST',
    'REDIS_HOST_UNDEFINED',
    'REDIS_HOST_US_WEST_2'
];

const loadConstants = async (env: NodeJS.ProcessEnv = {}) => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    for (const key of CONTROLLED_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    return import('./index');
};

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
});

describe('constants environment defaults', () => {
    it('defaults to preview network and localhost Redis outside AWS', async () => {
        const constants = await loadConstants();

        expect(constants.IS_SERVER).toBe(true);
        expect(constants.IS_LOCAL).toBe(false);
        expect(constants.NETWORK).toBe('preview');
        expect(constants.REDIS_HOST).toBe('127.0.0.1');
        expect(constants.AUTH_GRANT_DURATION).toBe(1000 * 60 * 60 * 24 * 30);
        expect(constants.TOU_URL).toBe('https://handle.me/$/tou');
    });

    it('prefers region-specific Redis host before the generic fallback', async () => {
        const constants = await loadConstants({
            AWS_REGION: 'us-west-2',
            REDIS_HOST: 'redis.default.internal',
            REDIS_HOST_US_WEST_2: 'redis.us-west-2.internal'
        });

        expect(constants.REDIS_HOST).toBe('redis.us-west-2.internal');
    });

    it('falls back to the generic Redis host when no region-specific host exists', async () => {
        const constants = await loadConstants({
            AWS_REGION: 'us-east-1',
            REDIS_HOST: 'redis.default.internal'
        });

        expect(constants.REDIS_HOST).toBe('redis.default.internal');
    });

    it('normalizes the network before computing production mode', async () => {
        const mainnet = await loadConstants({ NETWORK: 'MAINNET', NODE_ENV: 'production' });
        const preview = await loadConstants({ NETWORK: 'preview', NODE_ENV: 'production' });

        expect(mainnet.NETWORK).toBe('mainnet');
        expect(mainnet.IS_PRODUCTION).toBe(true);
        expect(preview.IS_PRODUCTION).toBe(false);
    });
});
