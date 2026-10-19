import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { objectStoreConfig } from './objectStore';

// Invariant: the real S3-protocol SDK sends object writes only to the explicit R2 endpoint/key/region.
// Failure caught: a config regression delegates endpoint or credentials back to AWS discovery.
// Negative control: returning a region-only config is denied by the test network guard; substituting
// ambient credentials/region fails the independently observed authorization scope.
it('routes a real signed upload to the configured owned object-store endpoint', async () => {
    const requests: { path: string; host: string; authorization: string; body: string }[] = [];
    const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        requests.push({ path: new URL(request.url!, 'http://localhost').pathname,
            host: request.headers.host!, authorization: request.headers.authorization!,
            body: Buffer.concat(chunks).toString() });
        response.writeHead(200, { etag: '"local-r2-proof"' }); response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const client = new S3Client({ ...objectStoreConfig({
        R2_ENDPOINT: `http://127.0.0.1:${port}`, R2_ACCESS_KEY_ID: 'r2-test-key', R2_SECRET_ACCESS_KEY: 'r2-test-secret',
        AWS_REGION: 'us-west-2', AWS_ACCESS_KEY_ID: 'must-not-be-used', AWS_SECRET_ACCESS_KEY: 'must-not-be-used'
    }), forcePathStyle: true, maxAttempts: 1 });
    try {
        const result = await client.send(new PutObjectCommand({ Bucket: 'test-bucket', Key: 'routing-proof.txt', Body: Buffer.from('r2-routing-proof') }));
        expect(result.ETag).toBe('"local-r2-proof"');
        expect(requests).toHaveLength(1);
        expect(requests[0].path).toBe('/test-bucket/routing-proof.txt');
        expect(requests[0].host).toBe(`127.0.0.1:${port}`);
        expect(requests[0].authorization).toContain('Credential=r2-test-key/');
        expect(requests[0].authorization).toContain('/auto/s3/aws4_request');
        expect(requests[0].body).toContain('r2-routing-proof');
    } finally {
        client.destroy(); server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
