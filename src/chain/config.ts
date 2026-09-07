import { ChainProvider } from './failover/interfaces';
import { ChainProviderConfig, normalizeNetwork } from './providerConfig';
import { Koios } from './providers/Koios';
import { Blockfrost } from './providers/Blockfrost';

export * from './providerConfig';

/** Read a ChainProviderConfig from the standard environment variables. */
export const chainConfigFromEnv = (env: NodeJS.ProcessEnv = process.env): ChainProviderConfig => ({
    network: normalizeNetwork(env.NETWORK ?? 'mainnet'),
    koiosBearerToken: env.KOIOS_API_BEARER_TOKEN?.trim() || undefined,
    blockfrostApiKey: env.BLOCKFROST_API_KEY?.trim() || undefined,
    apiHost: env.HANDLE_API_ENDPOINT?.trim() || undefined,
    apiHeaders: buildApiHeaders(env)
});

const buildApiHeaders = (env: NodeJS.ProcessEnv): Record<string, string> | undefined => {
    const headers: Record<string, string> = {};
    if (env.HANDLE_ME_API_KEY?.trim()) headers['api-key'] = env.HANDLE_ME_API_KEY.trim();
    if (env.KORA_USER_AGENT?.trim()) headers['User-Agent'] = env.KORA_USER_AGENT.trim();
    return Object.keys(headers).length ? headers : undefined;
};

/**
 * Factory for the default read-failover provider set: Koios + Blockfrost, mutually redundant.
 */
export const buildChainProviders = (config: ChainProviderConfig): ChainProvider[] => [
    new Koios(config),
    new Blockfrost(config)
];
