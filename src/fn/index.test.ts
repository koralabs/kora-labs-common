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

    it('delivers a TEXT request body RAW (isBase64Encoded=false), like ALB — JSON.parse(event.body) works', async () => {
        // Regression: the bridge used to always base64-encode the body, so a handler that read the
        // body directly (JSON.parse(event.body)) parsed a base64 string and threw -> 500.
        let seen: any;
        const handler: AlbHandler = (event) => {
            seen = event;
            const parsed = JSON.parse(event.body!);
            return { statusCode: 200, body: JSON.stringify({ got: parsed.x }), isBase64Encoded: false };
        };
        const { ctx } = makeCtx('/echo', 'POST', { 'content-type': 'application/json' });
        const body = await invokeExpressViaAlb(handler, ctx, Buffer.from(JSON.stringify({ x: 42 }), 'utf-8'));
        expect(seen.isBase64Encoded).toBe(false);
        expect(seen.body).toBe(JSON.stringify({ x: 42 }));
        expect(body).toBe(JSON.stringify({ got: 42 }));
    });

    it('delivers a BINARY request body base64-encoded (isBase64Encoded=true), like ALB', async () => {
        let seen: any;
        const handler: AlbHandler = (event) => {
            seen = event;
            // echo the decoded request body back
            return { statusCode: 200, body: Buffer.from(event.body!, 'base64').toString('utf-8'), isBase64Encoded: false };
        };
        const { ctx } = makeCtx('/echo', 'POST', { 'content-type': 'application/octet-stream' });
        const body = await invokeExpressViaAlb(handler, ctx, Buffer.from('hello-fn', 'utf-8'));
        expect(seen.isBase64Encoded).toBe(true);
        expect(seen.body).toBe(Buffer.from('hello-fn').toString('base64'));
        expect(body).toBe('hello-fn');
    });

    it('throws if the function was not HTTP-triggered', async () => {
        const handler: AlbHandler = () => ({ statusCode: 200 });
        await expect(invokeExpressViaAlb(handler, {} as FnContext)).rejects.toThrow('httpGateway');
    });
});
