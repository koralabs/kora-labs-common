import { HANDLES_API_KEY, KORA_USER_AGENT } from "./constants";

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
            throw new Error("handle is required");
        }
        return await this.apiRequest(`/handles/${handle}`)
    }

    static async apiRequest(url: string, headers?: Record<string, string>, body?: any) {
        if (!HandlesApi._host) {
            throw new Error('HandlesApi has not been initialized. Please call HandlesApi.init(<network>)');
        }
        if (!headers){
            headers = {
                "Accepts": "application/json",
                "User-Agent": KORA_USER_AGENT,
                "api-key": HANDLES_API_KEY
            }
        }
        // We should probably use cross-fetch since this might get called on the front-end as well
        const response = (await fetch(`${HandlesApi._host}${url}`, {headers})).json();
        return response;
    }
}