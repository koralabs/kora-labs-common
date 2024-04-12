export class Request {
    method: string
    headers: Headers
    url: URL
    body?: string;
    constructor(req: {method: string, headers: Headers, url: URL, body?: string}) {
        this.method = req.method;
        this.headers = req.headers;
        this.url = req.url;
        this.body = req.body;
    }
    getCookie = (key: string): string | undefined => {
        return this.headers["Cookie"]?.split(/;\s?/gi).find(cookie => cookie.toLowerCase().startsWith(key.toLowerCase()))?.split('=')?.[1];
    }
}

export interface Headers {
    [key: string]: string
}

export class Response {
    body: any
    headers: Headers
    cookies: string[] = []
    status: number

    constructor(res: {body?: string, headers?: Headers, status?: number, cookies?: string[]}) {
        this.body = res?.body;
        this.headers = res?.headers ?? {};
        this.status = res?.status ?? 200;
        this.cookies = res?.cookies ?? [];
    }
    
    setCookie = (key: string, value: string, options?:{domain: string, maxAge: number, path: string}): void => {
        this.cookies.push(`${key}=${value}; ${options?.domain ? `Domain=${options.domain}; ` : ''}${options?.maxAge ? `Max-Age=${options.maxAge}; ` : ''}${options?.path ? `Path=${options.path}; ` : ''}Secure; HttpOnly`);
    }
}