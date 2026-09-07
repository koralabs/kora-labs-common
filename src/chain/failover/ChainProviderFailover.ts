import {
    AccountAsset,
    AddressInfo,
    BackgroundImageDetails,
    ChainProvider,
    ChainProviderAsset,
    ChainProviderUtxo
} from './interfaces';

export interface FailoverOptions {
    /**
     * Cooldown (ms) during which a provider that just failed is skipped as the *start* provider,
     * so a throttled/down provider doesn't add latency to every subsequent call. It is still used
     * as a fallback if the others also fail. Set 0 to disable (pure random start = legacy behavior).
     */
    unhealthyCooldownMs?: number;
    now?: () => number;
    /** Injectable RNG in [0,1) for deterministic start selection in tests. Defaults to Math.random. */
    random?: () => number;
}

/**
 * Health-aware failover across interchangeable ChainProviders. Reads start on a healthy provider
 * (random among healthy, else random overall) and fall through to the next on error — giving mutual
 * Koios/Blockfrost redundancy from a single call site. Ported from the handle.me BFF and generalized
 * (no app-level constants) so every repo shares it via kora-labs-common.
 */
export class ChainProviderFailover {
    private providers: ChainProvider[] = [];
    private unhealthyUntil: number[] = [];
    private readonly cooldownMs: number;
    private readonly now: () => number;
    private readonly random: () => number;

    constructor(providers: ChainProvider[], options: FailoverOptions = {}) {
        this.providers = providers;
        this.unhealthyUntil = providers.map(() => 0);
        this.cooldownMs = options.unhealthyCooldownMs ?? 30_000;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
    }

    private isHealthy(index: number): boolean {
        return this.unhealthyUntil[index] <= this.now();
    }

    private getStartIndex(): number {
        const healthy = this.providers.map((_, i) => i).filter((i) => this.isHealthy(i));
        const pool = healthy.length > 0 ? healthy : this.providers.map((_, i) => i);
        return pool[Math.floor(this.random() * pool.length)];
    }

    private getNextProviderIndex(currentIndex: number): number {
        return (currentIndex + 1) % this.providers.length;
    }

    private async getResponse<T>(
        funcName: keyof ChainProvider,
        args: any[],
        currentIndex?: number,
        runNum?: number
    ): Promise<T> {
        const num = runNum ?? 0;
        const index = currentIndex ?? this.getStartIndex();
        const chainProvider = this.providers[index];

        return await (chainProvider[funcName] as any)(...args).catch((error: any) => {
            // Mark the failed provider unhealthy for the cooldown window so it isn't chosen as the
            // start provider again immediately; it remains a valid fallback.
            if (this.cooldownMs > 0) this.unhealthyUntil[index] = this.now() + this.cooldownMs;
            if (num === this.providers.length - 1) throw error;
            return this.getResponse(funcName, args, this.getNextProviderIndex(index), num + 1);
        });
    }

    async getLatestTransactionForAsset(policyId: string, hex: string): Promise<string | null> {
        return this.getResponse('getLatestTransactionForAsset', [policyId, hex]);
    }

    async getLatestBlock(): Promise<{ height: number; slot: number; time: number }> {
        return this.getResponse('getLatestBlock', []);
    }

    async getAssets(policyId: string): Promise<{ policyId: string; hex: string }[]> {
        return this.getResponse('getAssets', [policyId]);
    }

    async getAssetDatum(policyId: string, hex: string): Promise<string | null> {
        return this.getResponse('getAssetDatum', [policyId, hex]);
    }

    async getCip25AssetImage(policyId: string, hex: string): Promise<string | null> {
        return this.getResponse('getCip25AssetImage', [policyId, hex]);
    }

    async getRefScriptCbor(tx: string, policyId: string, hex: string): Promise<string> {
        return this.getResponse('getRefScriptCbor', [tx, policyId, hex]);
    }

    async getTxUtxos(tx: string): Promise<ChainProviderUtxo> {
        return this.getResponse('getTxUtxos', [tx]);
    }

    async getAssetUtxo(policyId: string, hex: string): Promise<ChainProviderAsset | null> {
        // Asset resolution is correctness-critical (backs handle-resolution chain fallback): a
        // provider lagging a burn returns a stale UTxO and falsely resurrects a de-indexed handle.
        // Prefer Blockfrost (reads the latest asset tx live; Koios's tx index can lag a burn by
        // minutes). Koios stays the failover on error.
        const preferredIndex = this.providers.findIndex((p) => (p.name ?? '').toLowerCase().includes('blockfrost'));
        return this.getResponse('getAssetUtxo', [policyId, hex], preferredIndex >= 0 ? preferredIndex : undefined);
    }

    async getAssetsByStakeKey(stakeKey: string): Promise<AccountAsset[]> {
        return this.getResponse('getAssetsByStakeKey', [stakeKey]);
    }

    async getDatumFromHash(datumHash: string): Promise<string | null> {
        return this.getResponse('getDatumFromHash', [datumHash]);
    }

    async getBackgroundImageDetails(policyId: string, hex: string): Promise<BackgroundImageDetails> {
        return this.getResponse('getBackgroundImageDetails', [policyId, hex]);
    }

    async getAddressInfo(bech32Address: string): Promise<AddressInfo> {
        return this.getResponse('getAddressInfo', [bech32Address]);
    }

    async getAddressUTxOs(bech32Address: string): Promise<ChainProviderAsset[]> {
        return this.getResponse('getAddressUTxOs', [bech32Address]);
    }
}
