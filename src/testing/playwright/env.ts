/**
 * Live-suite configuration: gitignored dotenv files overlaid by the process environment.
 * Missing required configuration FAILS the suite — there is no "skip when unconfigured" path.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BlockfrostAccess, LiveNetwork } from '../blockfrost';

const LIVE_NETWORKS: LiveNetwork[] = ['preview', 'preprod', 'mainnet'];

/** Parse a dotenv-style file (`KEY=value`, `#` comments, optional quotes). A missing file is empty. */
export const readEnvFile = (file: string): Record<string, string> => {
    const values: Record<string, string> = {};
    if (!existsSync(file)) return values;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        values[trimmed.slice(0, eq).trim()] = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
    }
    return values;
};

/**
 * Copy each file's values into process.env where not already set (the environment wins; earlier
 * files win over later ones). For suites whose code reads optional knobs from process.env directly.
 */
export const loadEnvFiles = (files: string[], env: Record<string, string | undefined> = process.env) => {
    for (const file of files) {
        for (const [key, value] of Object.entries(readEnvFile(file))) if (!env[key]) env[key] = value;
    }
};

export const toLiveNetwork = (value: string): LiveNetwork => {
    const network = value.toLowerCase() as LiveNetwork;
    if (!LIVE_NETWORKS.includes(network)) throw new Error(`live suite: unknown network "${value}" (expected ${LIVE_NETWORKS.join(' | ')})`);
    return network;
};

export interface LiveEnvOptions {
    /** Dotenv files, highest precedence first. The environment wins over all of them. */
    files?: string[];
    /** Defaults to process.env. */
    env?: Record<string, string | undefined>;
    /** Defaults to `E2E_LIVE_NETWORK`, then preview. */
    network?: string;
    /** Variable holding this suite's CIP-1852 account index. Defaults to `E2E_LIVE_ACCOUNT_INDEX`. */
    accountIndexKey?: string;
    /** Account used when the variable is unset. Separate suites use separate accounts so they never contend for UTxOs. */
    defaultAccountIndex?: number;
}

export interface LiveEnv {
    network: LiveNetwork;
    mnemonic: string;
    blockfrostApiKey: string;
    accountIndex: number;
    /** `{ network, blockfrostApiKey }` for the chain reads. */
    chain: BlockfrostAccess;
    get(key: string): string | undefined;
    /** The value, or a thrown error naming where to set it. */
    required(key: string): string;
}

/** The shared live-suite variables: `E2E_LIVE_NETWORK`, `E2E_LIVE_WALLET_MNEMONIC`, `E2E_LIVE_BLOCKFROST_API_KEY`, and the account index. */
export const loadLiveEnv = (options: LiveEnvOptions = {}): LiveEnv => {
    const files = options.files ?? [];
    const env = options.env ?? process.env;
    const fromFiles = Object.assign({}, ...[...files].reverse().map(readEnvFile)) as Record<string, string>;
    const get = (key: string) => env[key] || fromFiles[key] || undefined;
    const required = (key: string) => {
        const value = get(key);
        if (!value) throw new Error(`live suite: ${key} is not configured (set it in the environment${files.length ? ` or ${files.join(', ')}` : ''})`);
        return value;
    };
    const network = toLiveNetwork(options.network ?? get('E2E_LIVE_NETWORK') ?? 'preview');
    const blockfrostApiKey = required('E2E_LIVE_BLOCKFROST_API_KEY');
    const accountIndexKey = options.accountIndexKey ?? 'E2E_LIVE_ACCOUNT_INDEX';
    const accountIndex = Number(get(accountIndexKey) ?? options.defaultAccountIndex ?? 0);
    if (!Number.isInteger(accountIndex) || accountIndex < 0) throw new Error(`live suite: ${accountIndexKey} must be a non-negative integer`);
    return {
        network,
        mnemonic: required('E2E_LIVE_WALLET_MNEMONIC'),
        blockfrostApiKey,
        accountIndex,
        chain: { network, blockfrostApiKey },
        get,
        required
    };
};
