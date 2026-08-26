import { Request, Response } from './';

describe('Request Tests', () => {
    it('should find cookie', () => {
        const request = new Request({
            headers: {'Content-Type': 'application/json'},
            method: 'GET',
            url: new URL('https://preview.handle.me')
        });
        request.headers['Cookie'] = 'abc=123; koracookiejar=abc%3D987|def%3D456|ghi%3D789';
        expect(request.getCookie('abc')).toEqual('123');
        expect(request.getCookie('def')).toEqual('456');
    });

    it('reads lower-case cookie headers and matches cookie keys case-insensitively', () => {
        const request = new Request({
            headers: { cookie: 'Session=abc; theme=dark' },
            method: 'GET',
            url: new URL('https://handle.me')
        });

        expect(request.getCookie('session')).toEqual('abc');
        expect(request.getCookie('THEME')).toEqual('dark');
    });

    it('returns undefined when neither direct cookies nor the cookie jar contain the key', () => {
        const request = new Request({
            headers: { Cookie: 'abc=123; koracookiejar=def%3D456' },
            method: 'GET',
            url: new URL('https://handle.me')
        });

        expect(request.getCookie('missing')).toBeUndefined();
    });
});

describe('Response Tests', () => {
    it('uses constructor defaults when optional fields are omitted', () => {
        const response = new Response({});

        expect(response.body).toBeUndefined();
        expect(response.headers).toEqual({});
        expect(response.status).toEqual(200);
        expect(response.cookies).toEqual([]);
    });

    it('preserves constructor values and appends secure HttpOnly cookies', () => {
        const response = new Response({
            body: 'ok',
            headers: { 'Content-Type': 'text/plain' },
            status: 201,
            cookies: ['existing=true']
        });

        response.setCookie('session', 'abc', { domain: '.handle.me', maxAge: 3600, path: '/' });
        response.setCookie('flag', '1');

        expect(response.body).toEqual('ok');
        expect(response.headers).toEqual({ 'Content-Type': 'text/plain' });
        expect(response.status).toEqual(201);
        expect(response.cookies).toEqual([
            'existing=true',
            'session=abc; Domain=.handle.me; Max-Age=3600; Path=/; Secure; HttpOnly',
            'flag=1; Secure; HttpOnly'
        ]);
    });
});
