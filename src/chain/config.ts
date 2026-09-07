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
    apiHost: env.HANDLE_API_ENDPOINT?.trim() || undefined
});

/**
 * Factory for the default read-failover provider set: Koios + Blockfrost, mutually redundant.
 */
export const buildChainProviders = (config: ChainProviderConfig): ChainProvider[] => [
    new Koios(config),
    new Blockfrost(config)
];
