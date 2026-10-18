import { KMSClient, ListKeysCommand } from '@aws-sdk/client-kms';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';

// Invariant: ambient AWS identities/config/metadata cannot be inherited by any application import.
// Failure caught: a unit test silently discovers the operator's real account credentials.
// Negative control: remove the preload and these controlled environment values are no longer guaranteed.
it('starts with an inert AWS environment before SDK use', () => {
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(process.env.AWS_PROFILE).toBeUndefined();
    expect(process.env.AWS_SHARED_CREDENTIALS_FILE).toBe('/dev/null');
    expect(process.env.AWS_CONFIG_FILE).toBe('/dev/null');
    expect(process.env.AWS_EC2_METADATA_DISABLED).toBe('true');
    expect(process.env.AWS_ENDPOINT_URL_KMS).toBe('http://aws-test.invalid');
    expect(process.env.AWS_ENDPOINT_URL_S3).toBe('http://aws-test.invalid');
});

// Invariant: real SDK clients cannot escape even with explicit credentials/production endpoints.
// Failure caught: an unfaked KMS/S3 request reaches a real account or metadata credential endpoint.
// Negative control: removing the socket/request guard permits the deliberately explicit real SDK dispatch.
it.each(['kms', 's3'])('denies an unfaked %s client at the network boundary', async service => {
    const config = { region: 'us-east-1', maxAttempts: 1,
        credentials: { accessKeyId: 'test-only-not-real', secretAccessKey: 'test-only-not-real' },
        endpoint: service === 'kms' ? 'https://kms.us-east-1.amazonaws.com' : 'https://s3.us-east-1.amazonaws.com' };
    const client = service === 'kms' ? new KMSClient(config) : new S3Client(config);
    try {
        const request = service === 'kms'
            ? (client as KMSClient).send(new ListKeysCommand({}))
            : (client as S3Client).send(new ListBucketsCommand({}));
        await expect(request).rejects.toMatchObject({ code: 'TEST_NETWORK_DENIED' });
    } finally { client.destroy(); }
});

// Invariant: non-SDK HTTP, fetch and raw sockets cannot bypass the same restriction.
// Failure caught: a new transport ignores the AWS endpoint override and contacts the outside world.
// Negative control: unguarding any transport changes its rejection to a real network attempt.
it('denies HTTP, HTTPS, fetch, TCP, TLS and unowned loopback ports', async () => {
    expect(() => http.get('http://169.254.169.254/latest/meta-data/')).toThrow('Test network denied');
    expect(() => https.get('https://example.com')).toThrow('Test network denied');
    await expect(fetch('https://example.com')).rejects.toMatchObject({ code: 'TEST_NETWORK_DENIED' });
    expect(() => net.connect({ host: '203.0.113.1', port: 443 })).toThrow('Test network denied');
    expect(() => tls.connect({ host: '203.0.113.1', port: 443 })).toThrow('Test network denied');
    expect(() => net.connect({ host: '127.0.0.1', port: 9 })).toThrow('Test network denied');
});

// Invariant: real loopback servers created by this process work only while their port is owned.
// Failure caught: a blanket localhost exception reaches an ambient service, or a blanket deny breaks tests.
// Negative control: stop tracking listen/close and the allowed fetch or post-close denial fails.
it('allows only this process loopback listeners and revokes them on close', async () => {
    const server = http.createServer((_request, response) => { response.end('local-test-response'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
        expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('local-test-response');
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    expect(() => net.connect({ host: '127.0.0.1', port })).toThrow('Test network denied');
});
