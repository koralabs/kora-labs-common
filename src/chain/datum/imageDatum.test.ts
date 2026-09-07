import { decode0xHexToUtf8, normalizeCreatorDefaultTextFields, getImageDataFromDatum } from './imageDatum';

describe('imageDatum', () => {
    it('decode0xHexToUtf8 decodes 0x-prefixed hex text, passes through plain values', () => {
        // "dots,#112233" hex-encoded — a qr_dot value the api decoder leaves as 0x-hex.
        const hex = '0x' + Buffer.from('dots,#112233').toString('hex');
        expect(decode0xHexToUtf8(hex)).toBe('dots,#112233');
        expect(decode0xHexToUtf8('already-decoded')).toBe('already-decoded');
        expect(decode0xHexToUtf8('#112233')).toBe('#112233'); // not 0x-prefixed -> untouched
    });

    it('normalizeCreatorDefaultTextFields only touches the known free-text fields', () => {
        const cd: Record<string, unknown> = {
            font: '0x' + Buffer.from('Inter').toString('hex'),
            qr_dot: '0x' + Buffer.from('dots').toString('hex'),
            some_colour: '0xdeadbeef' // not in the text-field list -> left as-is
        };
        normalizeCreatorDefaultTextFields(cd);
        expect(cd.font).toBe('Inter');
        expect(cd.qr_dot).toBe('dots');
        expect(cd.some_colour).toBe('0xdeadbeef');
    });

    it('getImageDataFromDatum extracts image + normalizes Constr-wrapped creator defaults', async () => {
        const fetcher = async () => ({
            text: async () =>
                JSON.stringify({
                    constructor_0: {
                        '0': { image: 'ipfs://bg', name: 'BG' },
                        '2': { constructor_0: { '0': { font: '0x' + Buffer.from('Inter').toString('hex') } } }
                    }
                })
        });
        const result = await getImageDataFromDatum('https://api', 'deadbeefcbor', { fetcher: fetcher as any });
        expect(result.image).toBe('ipfs://bg');
        expect(result.creatorDefaults).toEqual({ font: 'Inter' });
        expect(result.metadata).toEqual({ image: 'ipfs://bg', name: 'BG' });
    });

    it('forwards api headers (api-key/User-Agent) to the /datum decode request', async () => {
        // Correctness: the Handles API gates /datum by api-key; dropping it silently changes decoding.
        let sentHeaders: any;
        const fetcher = async (_url: string, init: any) => {
            sentHeaders = init.headers;
            return { text: async () => JSON.stringify({ constructor_0: { '0': { image: 'i' } } }) };
        };
        await getImageDataFromDatum('https://api', 'cbor', {
            fetcher: fetcher as any,
            headers: { 'api-key': 'secret', 'User-Agent': 'kora' }
        });
        expect(sentHeaders['api-key']).toBe('secret');
        expect(sentHeaders['User-Agent']).toBe('kora');
        expect(sentHeaders['Content-Type']).toBe('application/json');
    });

    it('getImageDataFromDatum returns empty image when decode throws (never crashes the caller)', async () => {
        const fetcher = async () => {
            throw new Error('decoder down');
        };
        const result = await getImageDataFromDatum('https://api', 'x', { fetcher: fetcher as any });
        expect(result).toEqual({ image: '' });
    });

    it('getImageDataFromDatum tolerates an empty decoder response', async () => {
        const fetcher = async () => ({ text: async () => '' });
        const result = await getImageDataFromDatum('https://api', 'x', { fetcher: fetcher as any });
        expect(result.image).toBeUndefined();
    });
});
