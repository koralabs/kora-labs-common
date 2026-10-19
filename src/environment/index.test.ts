import { CardanoNetwork } from '../types';
import { Environment } from './index';

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CWD = process.cwd;

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APPLICATION_NAME;
    delete process.env.NETWORK;
});

afterEach(() => {
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
    process.cwd = ORIGINAL_CWD;
    jest.restoreAllMocks();
});

describe('Environment', () => {
    it('maps NETWORK case-insensitively and returns UNSET when missing or unknown', () => {
        process.env.NETWORK = 'mainnet';
        expect(Environment.getCardanoNetwork()).toBe(CardanoNetwork.MAINNET);
        process.env.NETWORK = 'PreProd';
        expect(Environment.getCardanoNetwork()).toBe(CardanoNetwork.PREPROD);
        delete process.env.NETWORK;
        expect(Environment.getCardanoNetwork()).toBe(CardanoNetwork.UNSET);
        process.env.NETWORK = 'unknown';
        expect(Environment.getCardanoNetwork()).toBeUndefined();
    });

    // Invariant: the application name never comes from cloud metadata; AWS-looking variables are ignored.
    // Failure caught: reintroduced EC2/ECS/Lambda discovery would fetch link-local metadata or return the Lambda name.
    // Negative control: restoring the Lambda or EC2 branch makes the fetch/return assertions fail.
    it('uses APPLICATION_NAME then cwd, never cloud metadata, even with AWS variables set', async () => {
        const fetcher = jest.fn(async () => { throw new Error('network must not be used'); });
        global.fetch = fetcher as unknown as typeof fetch;
        Object.assign(process.env, { AWS_LAMBDA_FUNCTION_NAME: 'lambda-name', ECS_CLUSTER: 'cluster-name', AWS_REGION: 'us-east-1' });
        process.cwd = jest.fn(() => '/repo/app');
        await expect(Environment.getPotentialApplicationName()).resolves.toBe('/repo/app');
        process.env.APPLICATION_NAME = 'explicit-app';
        await expect(Environment.getPotentialApplicationName()).resolves.toBe('explicit-app');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('returns null when no name is configured and cwd throws', async () => {
        process.cwd = jest.fn(() => { throw new Error('cwd unavailable'); });
        await expect(Environment.getPotentialApplicationName()).resolves.toBeNull();
    });

    it('no longer exposes AWS compute or metadata discovery', () => {
        for (const removed of ['getComputeEnvironment', 'getIpAddress', 'getEc2InstanceName', 'getEcsTaskMetaData']) {
            expect((Environment as unknown as Record<string, unknown>)[removed]).toBeUndefined();
        }
    });
});
