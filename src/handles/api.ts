import { HANDLES_API_KEY, KORA_USER_AGENT } from './constants';
import { IHandle } from './interfaces';

// WHEN WE REVAMP THE SDK, THIS CAN ALL MOVE THERE
export class HandlesApi {
    private static _network?: string;
    private static _host?: string;

    static init(options:{network?: string, host?: string} = {network: 'mainnet'} ) {
        if (options.host) {
            HandlesApi._host = options.host;
        }
        else {
            HandlesApi._host = `https://${options.network == 'mainnet' ? '' : `${options.network}.`}api.handle.me`;
        }
        HandlesApi._network = options.network;
    }

    static async getHandle(handle: string) {
        if (!handle){
            throw new Error('handle is required');
        }
        const handleJson = await this.apiRequest(`/handles/${handle}`) as IHandle;
        // This should be coming from the API. The API needs to start setting this
        handleJson.policy = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
        return handleJson;
    }

    static async apiRequest(url: string, headers?: Record<string, string>, body?: any) {
        body;
        if (!HandlesApi._host) {
            throw new Error('HandlesApi has not been initialized. Please call HandlesApi.init(<network>)');
        }
        if (!headers){
            headers = {
                'Accepts': 'application/json',
                'User-Agent': KORA_USER_AGENT,
                'api-key': HANDLES_API_KEY
            }
        }
        // We should probably use cross-fetch since this might get called on the front-end as well
        const response = (await fetch(`${HandlesApi._host}${url}`, {headers})).json();
        return response;
    }
}