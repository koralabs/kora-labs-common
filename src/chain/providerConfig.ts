// Leaf config module (no imports from providers) so the concrete providers and the factory can both
// depend on it without a cycle.

/**
 * Configuration for the concrete chain providers. Injected explicitly (no reading of app-level
 * constants) so every consumer wires its own env once and the module stays app-agnostic.
 */
export interface ChainProviderConfig {
    /** 'mainnet' | 'preview' | 'preprod' — selects Koios/Blockfrost hosts. */
    network: string;
    /** Koios bearer token (optional; anonymous tier works without it). */
    koiosBearerToken?: string;
    /** Blockfrost project id for the target network. */
    blockfrostApiKey?: string;
    /**
     * Base URL of the Handles API used for schema-guided datum decoding (POST /datum). Defaults to
     * the public api.handle.me host for the network. Preserves the exact datum-decode behavior the
     * BFF relied on (schema-pathed UTF-8 field decoding), which is handle-property-correctness
     * critical — do NOT swap it for a local CBOR decode without matching that behavior.
     */
    apiHost?: string;
}

export const normalizeNetwork = (network: string): string => (network || 'mainnet').toLowerCase();

/** Public api.handle.me host for a network (mainnet has no subdomain prefix). */
export const defaultApiHost = (network: string): string => {
    const net = normalizeNetwork(network);
    return net === 'mainnet' ? 'https://api.handle.me' : `https://${net}.api.handle.me`;
};
