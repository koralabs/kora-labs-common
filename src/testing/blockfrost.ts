/**
 * Blockfrost access for the live-suite harness. Every call goes through the shared rate-limited
 * transport (`chain/transport/fetchProviderJson`): a stated wait (Retry-After and friends) is
 * remembered process-wide and never undercut, and a wait too long to sit out surfaces as
 * `RateLimitedError` instead of a retry.
 */
import { fetchProviderJson, ProviderRequestOptions } from '../chain/transport/fetchProviderJson';

export type LiveNetwork = 'preview' | 'preprod' | 'mainnet';

export interface BlockfrostAccess {
    network: LiveNetwork;
    blockfrostApiKey: string;
    /** Injectable for tests. Defaults to global fetch. */
    fetchFn?: typeof fetch;
}

export const blockfrostBaseUrl = (network: LiveNetwork) => `https://cardano-${network}.blockfrost.io/api/v0`;

const request = <T>(access: BlockfrostAccess, path: string, init: { method?: string; body?: Uint8Array; contentType?: string } = {}) =>
    fetchProviderJson<T>({
        provider: 'Blockfrost',
        url: `${blockfrostBaseUrl(access.network)}${path}`,
        method: init.method ?? 'GET',
        headers: { project_id: access.blockfrostApiKey, ...(init.contentType ? { 'Content-Type': init.contentType } : {}) },
        body: init.body,
        fetcher: access.fetchFn as ProviderRequestOptions['fetcher']
    });

/** GET `path`; null when Blockfrost answers 404 (never used / not on chain yet). */
export const blockfrostGet = async <T>(access: BlockfrostAccess, path: string): Promise<T | null> => {
    try {
        return await request<T>(access, path);
    } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
    }
};

/** POST a signed tx to `/tx/submit`; resolves to the tx hash, or throws with the node's reason. */
export const blockfrostSubmit = async (access: BlockfrostAccess, signedTxCbor: string): Promise<string> => {
    try {
        return await request<string>(access, '/tx/submit', { method: 'POST', body: Buffer.from(signedTxCbor, 'hex'), contentType: 'application/cbor' });
    } catch (error) {
        const e = error as { status?: number; responseText?: string; blockfrostResponse?: { message?: string } };
        if (e.status === undefined) throw error;
        throw new Error(`Submit failed: ${e.status} ${e.blockfrostResponse?.message ?? e.responseText ?? ''}`.trim(), { cause: error });
    }
};
