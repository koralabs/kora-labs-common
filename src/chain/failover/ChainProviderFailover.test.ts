import { ChainProviderFailover } from './ChainProviderFailover';
import { ChainProvider } from './interfaces';

// Minimal fake provider: only the methods under test are real; the rest satisfy the interface.
const makeProvider = (name: string, impl: Partial<ChainProvider>): ChainProvider =>
    ({
        name,
        getLatestTransactionForAsset: async () => null,
        getLatestBlock: async () => ({ height: 0, slot: 0, time: 0 }),
        getAssets: async () => [],
        getAssetDatum: async () => null,
        getCip25AssetImage: async () => null,
        getRefScriptCbor: async () => '',
        getTxUtxos: async () => ({ outputs: [] }),
        getAssetUtxo: async () => null,
        getAssetsByStakeKey: async () => [],
        getDatumFromHash: async () => null,
        getBackgroundImageDetails: async () => ({ image: '' }),
        getAddressInfo: async () => ({ address: '', amount: [], script: false }),
        getAddressUTxOs: async () => [],
        ...impl
    }) as ChainProvider;

describe('ChainProviderFailover', () => {
    it('falls over to the next provider when the first throws', async () => {
        const koios = makeProvider('Koios', {
            getAssetDatum: async () => {
                throw new Error('koios down');
            }
        });
        let bfCalls = 0;
        const blockfrost = makeProvider('Blockfrost', {
            getAssetDatum: async () => {
                bfCalls++;
                return 'datum';
            }
        });
        const failover = new ChainProviderFailover([koios, blockfrost], { unhealthyCooldownMs: 0 });
        expect(await failover.getAssetDatum('p', 'h')).toBe('datum');
        expect(bfCalls).toBe(1);
    });

    it('throws only after every provider fails', async () => {
        const p1 = makeProvider('Koios', { getAssetDatum: async () => { throw new Error('a'); } });
        const p2 = makeProvider('Blockfrost', { getAssetDatum: async () => { throw new Error('b'); } });
        const failover = new ChainProviderFailover([p1, p2], { unhealthyCooldownMs: 0 });
        await expect(failover.getAssetDatum('p', 'h')).rejects.toThrow();
    });

    it('getAssetUtxo prefers Blockfrost as the start provider (burn-freshness invariant)', async () => {
        const order: string[] = [];
        const koios = makeProvider('Koios', { getAssetUtxo: async () => { order.push('Koios'); return null; } });
        const blockfrost = makeProvider('Blockfrost', {
            getAssetUtxo: async () => {
                order.push('Blockfrost');
                return { address: 'a', amount: [], inline_datum: null, output_index: 0, tx_hash: 't', data_hash: null };
            }
        });
        // Put Koios first so a random/positional start could pick it; the preference must still hit BF first.
        const failover = new ChainProviderFailover([koios, blockfrost]);
        const utxo = await failover.getAssetUtxo('p', 'h');
        expect(utxo?.tx_hash).toBe('t');
        expect(order[0]).toBe('Blockfrost');
    });

    it('marks a failed provider unhealthy so it is skipped as the start provider during cooldown', async () => {
        let now = 0;
        const calls = { Koios: 0, Blockfrost: 0 };
        const koios = makeProvider('Koios', {
            getAssetDatum: async () => {
                calls.Koios++;
                throw new Error('koios down');
            }
        });
        const blockfrost = makeProvider('Blockfrost', {
            getAssetDatum: async () => {
                calls.Blockfrost++;
                return 'ok';
            }
        });
        // random=()=>0 deterministically starts on the first healthy provider.
        const failover = new ChainProviderFailover([koios, blockfrost], {
            unhealthyCooldownMs: 30_000,
            now: () => now,
            random: () => 0
        });

        // First call: starts on Koios (healthy pool [0,1] -> index 0), fails -> marked unhealthy -> BF serves.
        await failover.getAssetDatum('p', 'h');
        expect(calls.Koios).toBe(1);
        expect(calls.Blockfrost).toBe(1);

        // Within cooldown: healthy pool is [1] only, so start is BF and Koios is NOT re-hit.
        now = 10_000;
        await failover.getAssetDatum('p', 'h');
        await failover.getAssetDatum('p', 'h');
        expect(calls.Koios).toBe(1); // Koios not retried while unhealthy
        expect(calls.Blockfrost).toBe(3);

        // After cooldown expires, Koios is eligible again (healthy pool [0,1], random=0 -> Koios).
        now = 50_000;
        await failover.getAssetDatum('p', 'h');
        expect(calls.Koios).toBe(2); // Koios tried again (then falls over to BF)
        expect(calls.Blockfrost).toBe(4);
    });
});
