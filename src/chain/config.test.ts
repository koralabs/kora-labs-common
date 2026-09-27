import { buildChainProviders, chainConfigFromEnv } from './config';
import { defaultApiHost, normalizeNetwork } from './providerConfig';
import { Blockfrost } from './providers/Blockfrost';
import { buildKoiosAddressUtxoRequestBody, buildKoiosHeaders, Koios } from './providers/Koios';

describe('chain configuration', () => {
    it('normalizes network names and selects the public Handles API host', () => {
        expect(normalizeNetwork('PreProd')).toBe('preprod');
        expect(normalizeNetwork('')).toBe('mainnet');
        expect(defaultApiHost('MAINNET')).toBe('https://api.handle.me');
        expect(defaultApiHost('Preview')).toBe('https://preview.api.handle.me');
    });

    it('reads and trims provider credentials, endpoint, and API headers from the environment', () => {
        expect(chainConfigFromEnv({
            NETWORK: 'PreProd',
            KOIOS_API_BEARER_TOKEN: ' koios-token ',
            BLOCKFROST_API_KEY: ' blockfrost-key ',
            HANDLE_API_ENDPOINT: ' https://custom.example ',
            HANDLE_ME_API_KEY: ' handles-key ',
            KORA_USER_AGENT: ' kora-test '
        })).toEqual({
            network: 'preprod',
            koiosBearerToken: 'koios-token',
            blockfrostApiKey: 'blockfrost-key',
            apiHost: 'https://custom.example',
            apiHeaders: { 'api-key': 'handles-key', 'User-Agent': 'kora-test' }
        });
    });

    it('uses mainnet defaults and omits blank optional values', () => {
        expect(chainConfigFromEnv({
            KOIOS_API_BEARER_TOKEN: ' ',
            BLOCKFROST_API_KEY: '',
            HANDLE_API_ENDPOINT: ' ',
            HANDLE_ME_API_KEY: '',
            KORA_USER_AGENT: ' '
        })).toEqual({
            network: 'mainnet',
            koiosBearerToken: undefined,
            blockfrostApiKey: undefined,
            apiHost: undefined,
            apiHeaders: undefined
        });
    });

    it('builds the redundant Koios and Blockfrost provider pair', () => {
        const providers = buildChainProviders({ network: 'preview' });
        expect(providers).toHaveLength(2);
        expect(providers[0]).toBeInstanceOf(Koios);
        expect(providers[1]).toBeInstanceOf(Blockfrost);
        expect(providers.map(({ name }) => name)).toEqual(['Koios', 'Blockfrost']);
    });

    it('builds Koios authorization headers and address request bodies', () => {
        expect(buildKoiosHeaders(undefined)).toEqual({ 'Content-Type': 'application/json' });
        expect(buildKoiosHeaders('secret')).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret'
        });
        expect(buildKoiosAddressUtxoRequestBody('addr_test1xyz')).toEqual({
            _addresses: ['addr_test1xyz'],
            _extended: true
        });
    });
});
