import { invokeExpressViaAlb, type AlbHandler, type FnContext } from './index';

// Minimal stand-in for the Fn FDK HTTPGatewayContext.
const makeCtx = (requestURL: string, method: string, headers: Record<string, string | string[]> = {}) => {
    const responseHeaders: Record<string, string[]> = {};
    const gw = {
        requestURL,
        method,
        headers,
        statusCode: 0,
        setResponseHeader: (k: string, ...v: string[]) => { responseHeaders[k.toLowerCase()] = v; },
        addResponseHeader: (k: string, ...v: string[]) => { (responseHeaders[k.toLowerCase()] ??= []).push(...v); }
    };
    return { ctx: { httpGateway: gw } as FnContext, gw, responseHeaders };
};

describe('invokeExpressViaAlb (Fn <-> ALB bridge)', () => {
    it('builds an ALB event from the Fn request and maps the ALB response back', async () => {
        let seen: any;
        const handler: AlbHandler = (event) => {
            seen = event;
            return {
                statusCode: 201,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ok: true }),
                isBase64Encoded: false
            };
        };
        const { ctx, gw, responseHeaders } = makeCtx('/handles?a=1&a=2&b=x', 'GET', { 'X-Test': 'yes' });

        const body = await invokeExpressViaAlb(handler, ctx);

        // ALB event shape the app's serverless-express handler expects.
        expect(seen.requestContext.elb).toBeDefined();
        expect(seen.httpMethod).toBe('GET');
        expect(seen.path).toBe('/handles');
        expect(seen.queryStringParameters).toEqual({ a: '2', b: 'x' });
        expect(seen.multiValueQueryStringParameters).toEqual({ a: ['1', '2'], b: ['x'] });
        expect(seen.headers['x-test']).toBe('yes');

        // Response mapped back onto the Fn gateway.
        expect(gw.statusCode).toBe(201);
        expect(responseHeaders['content-type']).toEqual(['application/json']);
        expect(body).toBe(JSON.stringify({ ok: true }));
    });

    it('round-trips a base64 (binary) request body to the handler and decodes a base64 response', async () => {
        const handler: AlbHandler = (event) => ({
            statusCode: 200,
            // echo the decoded request body back, base64-encoded
            body: Buffer.from(event.body!, 'base64').toString('utf-8'),
            isBase64Encoded: false
        });
        const { ctx } = makeCtx('/echo', 'POST');
        const body = await invokeExpressViaAlb(handler, ctx, Buffer.from('hello-fn', 'utf-8'));
        expect(body).toBe('hello-fn');
    });

    it('throws if the function was not HTTP-triggered', async () => {
        const handler: AlbHandler = () => ({ statusCode: 200 });
        await expect(invokeExpressViaAlb(handler, {} as FnContext)).rejects.toThrow('httpGateway');
    });
});
