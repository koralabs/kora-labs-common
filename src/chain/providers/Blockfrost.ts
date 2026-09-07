import { AssetNameLabel } from '../../types';
import { ICreatorDefaults } from '../../handles/interfaces';
import { AccountAsset, AddressInfo, ChainProvider, ChainProviderAsset, ChainProviderUtxo } from '../failover/interfaces';
import { fetchProviderJson } from '../transport/fetchProviderJson';
import { getImageDataFromDatum } from '../datum/imageDatum';
import { ChainProviderConfig, defaultApiHost } from '../providerConfig';

export interface DrepMetadataValue {
    '@value': string;
}

export interface DrepReference {
    '@type': string;
    label: string | DrepMetadataValue;
    uri: string | DrepMetadataValue;
}

interface DrepMetadata {
    drep_id: string;
    json_metadata: {
        body: {
            paymentAddress: string | DrepMetadataValue;
            givenName: string | DrepMetadataValue;
            image: { contentUrl: string | DrepMetadataValue };
            objectives: string | DrepMetadataValue;
            motivations: string | DrepMetadataValue;
            qualifications: string | DrepMetadataValue;
            references: DrepReference[];
        };
    };
}

export class Blockfrost implements ChainProvider {
    name = 'Blockfrost';

    constructor(private readonly config: ChainProviderConfig) {}

    private async fetchBlockfrost(path: string): Promise<any> {
        const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
        const url = `https://cardano-${this.config.network.toLowerCase()}.blockfrost.io/api/v0/${normalizedPath}`;

        return fetchProviderJson<any>({
            provider: 'Blockfrost',
            url,
            headers: {
                'Content-Type': 'application/json',
                project_id: this.config.blockfrostApiKey ?? ''
            }
        });
    }

    async getDrepMetadata(drepId: string): Promise<DrepMetadata> {
        return await this.fetchBlockfrost(`/governance/dreps/${drepId}/metadata`);
    }

    async getLatestBlock(): Promise<{ height: number; slot: number; time: number }> {
        return await this.fetchBlockfrost('blocks/latest');
    }

    async getLatestTransactionForAsset(policyId: string, hex: string): Promise<string | null> {
        const res = await this.fetchBlockfrost(`/assets/${policyId}${hex}/transactions?order=desc`);
        const [tx] = res;
        return tx?.tx_hash ?? null;
    }

    async getAssets(policyId: string): Promise<{ policyId: string; hex: string }[]> {
        const res = await this.fetchBlockfrost(`/assets/policy/${policyId}`);
        if (!Array.isArray(res)) return [];

        return (
            res?.reduce((agg: { policyId: string; hex: string }[], item: any) => {
                const { asset, quantity } = item;
                const [, hex] = asset.split(policyId);
                if (hex.includes(AssetNameLabel.LBL_100) || quantity === '0') return agg;
                agg.push({ policyId, hex });
                return agg;
            }, []) ?? []
        );
    }

    async getAssetUtxo(policyId: string, hex: string): Promise<ChainProviderAsset | null> {
        // A BURN that only spends the asset is NOT listed by /assets/{asset}/transactions, so
        // getLatestTransactionForAsset returns the pre-burn output tx and the asset is still in its
        // (now-spent) outputs — we'd resurrect a de-indexed handle. /assets DOES reflect the burn
        // (quantity 0), so gate on current supply first: a burned (or absent) asset resolves to null.
        const info: any = await this.fetchBlockfrost(`/assets/${policyId}${hex}`);
        if (!info || info.status_code === 404 || String(info.quantity) === '0') return null;

        const tx = await this.getLatestTransactionForAsset(policyId, hex);
        if (!tx) return null;
        const res = await this.fetchBlockfrost(`/txs/${tx}/utxos`);

        const asset = res?.outputs?.find((output: any) => output.amount.some((a: any) => a.unit === `${policyId}${hex}`));
        // Defensive: if the latest tx lists the asset only in inputs, return null.
        if (!asset) return null;

        return { ...asset, tx_hash: tx };
    }

    async getDatumFromHash(datumHash: string): Promise<string | null> {
        const result = await this.fetchBlockfrost(`/scripts/datum/${datumHash}/cbor`);
        if (result.status) return null;
        return result.cbor;
    }

    async getAssetDatum(policyId: string, hex: string): Promise<string | null> {
        const asset = await this.getAssetUtxo(policyId, hex);
        return asset?.inline_datum ?? null;
    }

    async getCip25AssetImage(policyId: string, hex: string): Promise<string | null> {
        const res = await this.fetchBlockfrost(`/assets/${policyId}${hex}`);
        let image = res?.onchain_metadata?.image ?? null;
        if (Array.isArray(image)) image = image.join('');
        return image;
    }

    async getRefScriptCbor(tx: string, policyId: string, hex: string): Promise<string> {
        const res = await this.fetchBlockfrost(`/txs/${tx}/utxos`);
        const output = res.outputs.find((o: any) => o.amount.some((a: any) => a.unit === `${policyId}${hex}`));
        const scriptHash = output?.reference_script_hash;
        const { cbor } = await this.fetchBlockfrost(`/scripts/${scriptHash}/cbor`);
        return cbor;
    }

    async getTxUtxos(tx: string): Promise<ChainProviderUtxo> {
        return await this.fetchBlockfrost(`/txs/${tx}/utxos`);
    }

    async getAssetsByStakeKey(stakeKey: string): Promise<AccountAsset[]> {
        const result: AccountAsset[] = [];
        let hasResults = true;
        let page = 1;
        while (hasResults) {
            const items = await this.fetchBlockfrost(`/accounts/${stakeKey}/addresses/assets?count=100&page=${page}`);
            if (items.length === 0) hasResults = false;
            result.push(...items.map((item: any) => ({ asset: item.unit, amount: item.quantity })));
            page++;
        }
        return result;
    }

    async getBackgroundImageDetails(
        policyId: string,
        hex: string
    ): Promise<{ image: string; creatorDefaults?: ICreatorDefaults; metadata?: Record<string, unknown> }> {
        const data = await this.fetchBlockfrost(`/assets/${policyId}${hex}`);

        const updateHex =
            hex.startsWith(AssetNameLabel.LBL_222) || hex.startsWith(AssetNameLabel.LBL_444)
                ? `${AssetNameLabel.LBL_100}${hex.replace(AssetNameLabel.LBL_222, '').replace(AssetNameLabel.LBL_444, '')}`
                : hex;

        const datum = await this.getAssetDatum(policyId, updateHex);
        if (datum) {
            return getImageDataFromDatum(this.config.apiHost ?? defaultApiHost(this.config.network), datum);
        }

        let image = '';
        if (data?.onchain_metadata && data?.onchain_metadata.image) {
            image = data?.onchain_metadata.image as string;
        }

        return { image, metadata: data?.onchain_metadata };
    }

    async getAddressInfo(bech32Address: string): Promise<AddressInfo> {
        const result = await this.fetchBlockfrost(`/addresses/${bech32Address}`);
        return {
            address: result.address,
            amount: result.amount,
            stake_address: result.stake_address,
            script: result.script
        };
    }

    async getAddressUTxOs(bech32Address: string): Promise<ChainProviderAsset[]> {
        return await this.fetchBlockfrost(`/addresses/${bech32Address}/utxos`);
    }
}
