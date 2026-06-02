// Fn <-> Express bridge for the self-hosted runtime (MIGRATION-PLAN §4).
//
// Each app already exposes an @vendia/serverless-express ALB handler (e.g.
// lambdas/api.app.ts `handler(event, ctx)`), which is how it ran on Lambda/ALB. Rather
// than invent a new req/res bridge, `invokeExpressViaAlb` adapts an Fn HTTP-trigger
// invocation INTO an ALB event, calls that existing handler, and maps the ALB response
// back to Fn. So the Fn function reuses the exact Express request handling the app already
// has, and apps need only a tiny func.js entrypoint:
//
//   const fdk = require('@fnproject/fdk');
//   const { handler } = require('./dist/lambdas/api.app');           // the app's ALB handler
//   const { invokeExpressViaAlb } = require('@koralabs/kora-labs-common');
//   fdk.handle((input, ctx) => invokeExpressViaAlb(handler, ctx, input), { inputMode: 'buffer' });
//
// Typed loosely (no @types/aws-lambda / @fnproject/fdk dependency here) — the shapes below
// match the ALB event/result and the Fn HTTPGatewayContext.

interface AlbEvent {
    requestContext: { elb: { targetGroupArn: string } };
    httpMethod: string;
    path: string;
    queryStringParameters: Record<string, string> | null;
    multiValueQueryStringParameters?: Record<string, string[]> | null;
    headers: Record<string, string>;
    body: string | null;
    isBase64Encoded: boolean;
}

interface AlbResult {
    statusCode?: number;
    statusDescription?: string;
    headers?: Record<string, string | number | boolean>;
    multiValueHeaders?: Record<string, Array<string | number | boolean>>;
    body?: string;
    isBase64Encoded?: boolean;
}

export type AlbHandler = (event: AlbEvent, context: Record<string, unknown>) => Promise<AlbResult> | AlbResult;

export interface FnHttpGateway {
    requestURL: string;
    method: string;
    headers: Record<string, string | string[]>;
    statusCode: number;
    setResponseHeader(key: string, ...values: string[]): void;
    addResponseHeader(key: string, ...values: string[]): void;
}

export interface FnContext {
    httpGateway?: FnHttpGateway;
}

const flattenHeaders = (h: Record<string, string | string[]> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h || {})) {
        out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
};

/**
 * Drive an app's ALB (serverless-express) handler from an Fn HTTP invocation.
 * @param albHandler the app's existing @vendia/serverless-express handler
 * @param ctx        the Fn FDK context (must be HTTP-triggered → ctx.httpGateway present)
 * @param input      the request body (Buffer, with fdk inputMode 'buffer')
 * @returns the response body (Buffer or string); status + headers are set on ctx.httpGateway
 */
export const invokeExpressViaAlb = async (
    albHandler: AlbHandler,
    ctx: FnContext,
    input?: Buffer | Uint8Array | string
): Promise<Buffer | string> => {
    const h = ctx.httpGateway;
    if (!h) throw new Error('invokeExpressViaAlb: ctx.httpGateway missing (the function must be HTTP-triggered)');

    // requestURL may be a bare path (`/handles?x=1`) or absolute; URL() needs a base.
    const url = new URL(h.requestURL, 'http://kora.local');
    const qs: Record<string, string> = {};
    const mqs: Record<string, string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(key);
        qs[key] = all[all.length - 1];
        mqs[key] = all;
    }

    const bodyBuf = input == null
        ? Buffer.alloc(0)
        : Buffer.isBuffer(input) ? input : Buffer.from(input as Uint8Array);

    const event: AlbEvent = {
        requestContext: { elb: { targetGroupArn: 'arn:kora:fn' } }, // marks this as an ALB event
        httpMethod: h.method,
        path: url.pathname,
        queryStringParameters: Object.keys(qs).length ? qs : null,
        multiValueQueryStringParameters: Object.keys(mqs).length ? mqs : null,
        headers: flattenHeaders(h.headers),
        body: bodyBuf.length ? bodyBuf.toString('base64') : null,
        isBase64Encoded: true
    };

    const res: AlbResult = (await albHandler(event, {})) || {};

    h.statusCode = res.statusCode ?? 200;
    if (res.headers) {
        for (const [k, v] of Object.entries(res.headers)) h.setResponseHeader(k, String(v));
    }
    if (res.multiValueHeaders) {
        for (const [k, arr] of Object.entries(res.multiValueHeaders)) {
            for (const v of arr) h.addResponseHeader(k, String(v));
        }
    }

    if (res.body == null) return '';
    return res.isBase64Encoded ? Buffer.from(res.body, 'base64') : res.body;
};
