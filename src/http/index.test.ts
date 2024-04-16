import { Request } from './'
describe('Request Tests', () => {
    it('should find cookie', () => {
        const request = new Request({
            headers: {'Content-Type': 'application/json'},
            method: 'GET',
            url: new URL('https://preview.handle.me')
        })
        request.headers['Cookie'] = 'abc=123; koracookiejar=abc%3D987|def%3D456|ghi%3D789'
        expect(request.getCookie('abc')).toEqual('123');
        expect(request.getCookie('def')).toEqual('456');
    });
});
