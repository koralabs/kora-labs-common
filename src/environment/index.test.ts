import { CardanoNetwork } from '../types';
import { ComputeEnvironment, Environment } from './index';

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CWD = process.cwd;

const resetEnv = () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_EXECUTION_ENV;
    delete process.env.ECS_CLUSTER;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_REGION;
    delete process.env.APPLICATION_NAME;
    delete process.env.NETWORK;
};

const mockFetch = (responses: Record<string, unknown>) => {
    global.fetch = jest.fn(async (url: string | URL | Request) => {
        const key = `${url}`;
        if (!(key in responses)) {
            throw new Error(`unexpected url: ${key}`);
        }
        const value = responses[key];
        return {
            text: async () => `${value}`,
            json: async () => value
        } as Response;
    });
};

describe('Environment', () => {
    beforeEach(() => {
        resetEnv();
        global.fetch = jest.fn(async () => {
            throw new Error('metadata unavailable');
        });
        jest.restoreAllMocks();
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        global.fetch = ORIGINAL_FETCH;
        process.cwd = ORIGINAL_CWD;
        jest.restoreAllMocks();
    });

    describe('getComputeEnvironment', () => {
        it('detects lambda from either lambda environment variable before other AWS signals', async () => {
            process.env.AWS_LAMBDA_FUNCTION_NAME = 'handler';
            process.env.ECS_CLUSTER = 'cluster';
            process.env.AWS_REGION = 'us-east-1';

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.AWS_LAMBDA);

            delete process.env.AWS_LAMBDA_FUNCTION_NAME;
            process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs24.x';

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.AWS_LAMBDA);
        });

        it('detects fargate before probing ec2 metadata', async () => {
            process.env.ECS_CLUSTER = 'cluster-name';

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.AWS_FARGATE);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('detects ec2 from metadata and falls back to regional AWS or other', async () => {
            mockFetch({
                'http://169.254.169.254/latest/meta-data/tags/instance/Name': 'api-instance'
            });

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.AWS_EC2);

            global.fetch = jest.fn(async () => {
                throw new Error('metadata unavailable');
            });
            process.env.AWS_DEFAULT_REGION = 'us-east-1';

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.AWS_OTHER);

            delete process.env.AWS_DEFAULT_REGION;
            delete process.env.AWS_REGION;

            await expect(Environment.getComputeEnvironment()).resolves.toBe(ComputeEnvironment.OTHER);
        });
    });

    describe('getCardanoNetwork', () => {
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
    });

    describe('getIpAddress', () => {
        it('returns ec2 private and public metadata when either address exists', async () => {
            jest.spyOn(Environment, 'getComputeEnvironment').mockResolvedValue(ComputeEnvironment.AWS_EC2);
            mockFetch({
                'http://169.254.169.254/latest/meta-data/local-ipv4': '10.0.1.20',
                'http://169.254.169.254/latest/meta-data/public-ipv4': '54.1.2.3'
            });

            await expect(Environment.getIpAddress()).resolves.toEqual({
                private: '10.0.1.20',
                public: '54.1.2.3'
            });
        });

        it('returns null outside ec2 when metadata is unavailable', async () => {
            jest.spyOn(Environment, 'getComputeEnvironment').mockResolvedValue(ComputeEnvironment.OTHER);

            await expect(Environment.getIpAddress()).resolves.toBeNull();
        });
    });

    describe('metadata helpers', () => {
        it('gets an ec2 name from the tag endpoint before falling back to instance id', async () => {
            mockFetch({
                'http://169.254.169.254/latest/meta-data/tags/instance/Name': 'worker-a'
            });

            await expect(Environment.getEc2InstanceName()).resolves.toBe('worker-a');
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('falls back to the ec2 instance id when name tag metadata fails', async () => {
            global.fetch = jest.fn(async (url: string | URL | Request) => {
                if (`${url}`.endsWith('/tags/instance/Name')) {
                    throw new Error('not enabled');
                }
                return { text: async () => 'i-abc123' } as Response;
            });

            await expect(Environment.getEc2InstanceName()).resolves.toBe('i-abc123');
        });

        it('returns ecs metadata json or null when metadata is unavailable', async () => {
            const metadata = { Networks: [{ IPv4Addresses: ['10.0.2.30'] }] };
            mockFetch({ 'http://169.254.170.2/v2/metadata': metadata });

            await expect(Environment.getEcsTaskMetaData()).resolves.toEqual(metadata);

            global.fetch = jest.fn(async () => {
                throw new Error('metadata unavailable');
            });
            await expect(Environment.getEcsTaskMetaData()).resolves.toBeNull();
        });
    });

    describe('getPotentialApplicationName', () => {
        it('prefers explicit, lambda, fargate, ec2, then cwd names', async () => {
            process.env.APPLICATION_NAME = 'explicit-app';
            await expect(Environment.getPotentialApplicationName()).resolves.toBe('explicit-app');

            delete process.env.APPLICATION_NAME;
            process.env.AWS_LAMBDA_FUNCTION_NAME = 'lambda-name';
            jest.spyOn(Environment, 'getComputeEnvironment').mockResolvedValueOnce(ComputeEnvironment.AWS_LAMBDA);
            await expect(Environment.getPotentialApplicationName()).resolves.toBe('lambda-name');

            delete process.env.AWS_LAMBDA_FUNCTION_NAME;
            process.env.ECS_CLUSTER = 'cluster-name';
            jest.spyOn(Environment, 'getComputeEnvironment')
                .mockResolvedValueOnce(ComputeEnvironment.OTHER)
                .mockResolvedValueOnce(ComputeEnvironment.AWS_FARGATE);
            await expect(Environment.getPotentialApplicationName()).resolves.toBe('cluster-name');

            delete process.env.ECS_CLUSTER;
            jest.spyOn(Environment, 'getComputeEnvironment')
                .mockResolvedValueOnce(ComputeEnvironment.OTHER)
                .mockResolvedValueOnce(ComputeEnvironment.OTHER)
                .mockResolvedValueOnce(ComputeEnvironment.AWS_EC2);
            jest.spyOn(Environment, 'getEc2InstanceName').mockResolvedValueOnce('ec2-name');
            await expect(Environment.getPotentialApplicationName()).resolves.toBe('ec2-name');

            jest.spyOn(Environment, 'getComputeEnvironment').mockResolvedValue(ComputeEnvironment.OTHER);
            process.cwd = jest.fn(() => '/repo/app');
            await expect(Environment.getPotentialApplicationName()).resolves.toBe('/repo/app');
        });

        it('returns null when no application name is discoverable and cwd throws', async () => {
            jest.spyOn(Environment, 'getComputeEnvironment').mockResolvedValue(ComputeEnvironment.OTHER);
            process.cwd = jest.fn(() => {
                throw new Error('cwd unavailable');
            });

            await expect(Environment.getPotentialApplicationName()).resolves.toBeNull();
        });
    });
});
