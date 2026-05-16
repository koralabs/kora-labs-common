import { HandlesApi } from './api';
import { HANDLES_API_KEY, KORA_USER_AGENT } from './constants';

const originalFetch = global.fetch;

describe('HandlesApi', () => {
    afterEach(() => {
        global.fetch = originalFetch;
        HandlesApi.init({network: 'mainnet'});
    });

    it('requires initialization before making API requests', async () => {
        (HandlesApi as unknown as {_host?: string})._host = undefined;

        await expect(HandlesApi.apiRequest('/handles/test')).rejects.toThrow(
            'HandlesApi has not been initialized. Please call HandlesApi.init(<network>)'
        );
    });

    it('selects the mainnet API host by default and applies default headers', async () => {
        const json = jest.fn().mockResolvedValue({handle: 'test'});
        const fetchMock = jest.fn().mockResolvedValue({json});
        global.fetch = fetchMock as unknown as typeof fetch;

        HandlesApi.init();

        await expect(HandlesApi.apiRequest('/handles/test')).resolves.toEqual({handle: 'test'});
        expect(fetchMock).toHaveBeenCalledWith('https://api.handle.me/handles/test', {
            headers: {
                Accepts: 'application/json',
                'User-Agent': KORA_USER_AGENT,
                'api-key': HANDLES_API_KEY
            }
        });
    });

    it('selects a network-specific API host', async () => {
        const json = jest.fn().mockResolvedValue({handle: 'preview'});
        const fetchMock = jest.fn().mockResolvedValue({json});
        global.fetch = fetchMock as unknown as typeof fetch;

        HandlesApi.init({network: 'preview'});

        await HandlesApi.apiRequest('/handles/preview');
        expect(fetchMock).toHaveBeenCalledWith('https://preview.api.handle.me/handles/preview', expect.any(Object));
    });

    it('uses a supplied host and headers unchanged', async () => {
        const json = jest.fn().mockResolvedValue({ok: true});
        const fetchMock = jest.fn().mockResolvedValue({json});
        const headers = {'x-test': 'yes'};
        global.fetch = fetchMock as unknown as typeof fetch;

        HandlesApi.init({host: 'https://handles.internal'});

        await HandlesApi.apiRequest('/health', headers);
        expect(fetchMock).toHaveBeenCalledWith('https://handles.internal/health', {headers});
    });

    it('requires a handle and patches the policy on getHandle responses', async () => {
        const json = jest.fn().mockResolvedValue({handle: 'test'});
        const fetchMock = jest.fn().mockResolvedValue({json});
        global.fetch = fetchMock as unknown as typeof fetch;
        HandlesApi.init({host: 'https://handles.internal'});

        await expect(HandlesApi.getHandle('')).rejects.toThrow('handle is required');
        await expect(HandlesApi.getHandle('test')).resolves.toEqual({
            handle: 'test',
            policy: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a'
        });
        expect(fetchMock).toHaveBeenCalledWith('https://handles.internal/handles/test', expect.any(Object));
    });
});
