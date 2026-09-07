import { AssetNameLabel } from '../../types';
import { ICreatorDefaults } from '../../handles/interfaces';
import { AccountAsset, AddressInfo, ChainProvider, ChainProviderAsset, ChainProviderUtxo } from '../failover/interfaces';
import { fetchProviderJson } from '../transport/fetchProviderJson';
import { getImageDataFromDatum } from '../datum/imageDatum';
import { ChainProviderConfig, defaultApiHost } from '../providerConfig';

interface KoiosAsset {
    quantity: string;
    policy_id: string;
    asset_name: string;
}

interface KoiosTxOutput {
    value: string;
    tx_hash: string;
    tx_index: number;
    asset_list: KoiosAsset[];
    datum_hash: string | null;
    stake_addr: string;
    inline_datum: { bytes: string | null; value: string | null } | null;
    payment_addr: { bech32: string };
    reference_script: { bytes: string | null; hash: string | null } | null;
}

interface KoiosTx {
    tx_hash: string;
    outputs: KoiosTxOutput[];
}

interface KoiosMetadata {
    '721'?: { [policyId: string]: { [assetName: string]: { image: string } } };
}

interface KoiosAddressInfo {
    address: string;
    balance: string;
    stake_address: string | null;
    script_address: boolean;
    utxo_set: {
        tx_hash: string;
        tx_index: number;
        block_height: number | null;
        block_time: number;
        value: string;
        datum_hash: string | null;
        inline_datum: { bytes: string | null; value: string | null } | null;
        reference_script: { bytes: string | null; hash: string | null } | null;
        asset_list:
            | { policy_id: string; asset_name: string | null; fingerprint: string; decimals: number; quantity: string }[]
            | null;
    }[];
}

export const buildKoiosHeaders = (bearerToken: string | undefined) => ({
    'Content-Type': 'application/json',
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
});

export const buildKoiosAddressUtxoRequestBody = (bech32Address: string) => ({
    _addresses: [bech32Address],
    _extended: true
});

export class Koios implements ChainProvider {
    name = 'Koios';

    constructor(private readonly config: ChainProviderConfig) {}

    private async fetchKoios<T>(path: string, method = 'GET', body?: string): Promise<T> {
        const network = this.config.network.toLowerCase();
        const host = network === 'mainnet' ? 'api' : network;
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const url = `https://${host}.koios.rest/api/v1${normalizedPath}`;

        return fetchProviderJson<T>({
            provider: 'Koios',
            url,
            method,
            headers: buildKoiosHeaders(this.config.koiosBearerToken),
            body
        });
    }

    async getLatestBlock(): Promise<{ height: number; slot: number; time: number }> {
        const blocks = await this.fetchKoios<any>('/blocks');
        const latestBlock = blocks[0];
        return { height: latestBlock.block_height, slot: latestBlock.abs_slot, time: latestBlock.block_time };
    }

    async getLatestTransactionForAsset(policyId: string, hex: string): Promise<string | null> {
        const res = await this.fetchKoios<{ tx_hash: string }[]>(`/asset_txs?_asset_policy=${policyId}&_asset_name=${hex}`);
        const [tx] = res;
        return tx?.tx_hash ?? null;
    }

    async getAssets(policyId: string): Promise<{ policyId: string; hex: string }[]> {
        const res = await this.fetchKoios(`/policy_asset_list?_asset_policy=${policyId}`);
        if (!Array.isArray(res)) return [];

        return (
            res?.reduce((agg: { policyId: string; hex: string }[], item: { asset_name: string; total_supply: string }) => {
                const { asset_name, total_supply } = item;
                if (asset_name.includes(AssetNameLabel.LBL_100) || total_supply === '0') return agg;
                agg.push({ policyId, hex: asset_name });
                return agg;
            }, []) ?? []
        );
    }

    async getAssetUtxo(policyId: string, hex: string): Promise<ChainProviderAsset | null> {
        const tx = await this.getLatestTransactionForAsset(policyId, hex);
        if (!tx) return null;

        const payload = { _tx_hashes: [tx], _metadata: true, _assets: true, _scripts: true, _bytecode: true };
        const res = await this.fetchKoios<KoiosTx[]>(`/tx_info`, 'POST', JSON.stringify(payload));
        const [firstTransaction] = res;

        const output = firstTransaction?.outputs?.find((o) =>
            o.asset_list.some((a) => a.policy_id === policyId && a.asset_name === hex)
        );
        if (!output) return null;

        const amount: { unit: string; quantity: string }[] = output.asset_list.map((a) => ({
            unit: `${a.policy_id}${a.asset_name}`,
            quantity: a.quantity
        }));
        amount.push({ unit: 'lovelace', quantity: output.value });

        const chainProviderAsset: ChainProviderAsset = {
            address: output.payment_addr.bech32,
            amount,
            inline_datum: output.inline_datum?.bytes ?? null,
            output_index: output.tx_index,
            tx_hash: firstTransaction.tx_hash,
            data_hash: output.datum_hash
        };

        return { ...chainProviderAsset, tx_hash: tx };
    }

    async getDatumFromHash(datumHash: string): Promise<string | null> {
        const result = await this.fetchKoios<{ bytes: string }[]>(
            `/datum_info`,
            'POST',
            JSON.stringify({ _datum_hashes: [datumHash] })
        );
        const [firstResult] = result;
        return firstResult ? firstResult.bytes : null;
    }

    async getAssetDatum(policyId: string, hex: string): Promise<string | null> {
        const assetUtxos = await this.fetchKoios<
            { datum_hash: string | null; inline_datum?: { bytes?: string | null }; asset_list: KoiosAsset[] }[]
        >(`/asset_utxos`, 'POST', JSON.stringify({ _asset_list: [[policyId, hex]], _extended: true }));

        const utxo = assetUtxos?.find((u) => u.asset_list.some((a) => a.policy_id === policyId && a.asset_name === hex));

        if (utxo?.inline_datum?.bytes) return utxo.inline_datum.bytes;
        if (!utxo?.inline_datum?.bytes && utxo?.datum_hash) return this.getDatumFromHash(utxo.datum_hash);
        return null;
    }

    async getRefScriptCbor(tx: string, policyId: string, hex: string): Promise<string> {
        const { outputs } = await this.getTxUtxos(tx);
        const output = outputs.find((o: any) => o.amount.some((a: any) => a.unit === `${policyId}${hex}`));
        return output?.reference_script_cbor ?? '';
    }

    async buildChainProviderAsset(output: KoiosTxOutput): Promise<ChainProviderAsset> {
        const amount: { unit: string; quantity: string }[] = output.asset_list.map((a) => ({
            unit: `${a.policy_id}${a.asset_name}`,
            quantity: a.quantity
        }));
        amount.push({ unit: 'lovelace', quantity: output.value });

        const inline_datum =
            !output?.inline_datum?.bytes && output?.datum_hash
                ? await this.getDatumFromHash(output.datum_hash)
                : output.inline_datum?.bytes ?? null;

        return {
            address: output.payment_addr.bech32,
            amount,
            inline_datum,
            output_index: output.tx_index,
            tx_hash: output.tx_hash,
            data_hash: output.datum_hash,
            reference_script_hash: output.reference_script?.hash ?? null,
            reference_script_cbor: output.reference_script?.bytes ?? null
        };
    }

    async getTxUtxos(tx: string): Promise<ChainProviderUtxo> {
        const res = await this.fetchKoios<KoiosTx[]>(
            `/tx_info`,
            'POST',
            JSON.stringify({ _tx_hashes: [tx], _metadata: true, _assets: true })
        );
        const [firstTransaction] = res;

        const outputs: ChainProviderAsset[] = [];
        for (const output of firstTransaction?.outputs ?? []) {
            outputs.push(await this.buildChainProviderAsset(output));
        }
        return { outputs };
    }

    async getAssetsByStakeKey(stakeKey: string): Promise<AccountAsset[]> {
        const items = await this.fetchKoios<
            { stake_address: string; policy_id: string; asset_name: string; quantity: string }[]
        >(`/account_assets`, 'POST', JSON.stringify({ _stake_addresses: [stakeKey] }));

        return items.reduce((agg: AccountAsset[], item) => {
            const { policy_id, asset_name, quantity } = item;
            if (quantity === '0') return agg;
            agg.push({ asset: `${policy_id}${asset_name}`, amount: quantity });
            return agg;
        }, []);
    }

    async getAssetMetadata(policyId: string, hex: string): Promise<Record<string, unknown> | undefined> {
        const assetInfo = await this.fetchKoios<
            { minting_tx_metadata?: KoiosMetadata; token_registry_metadata?: { logo?: string } }[]
        >(`/asset_info`, 'POST', JSON.stringify({ _asset_list: [[policyId, hex]] }));
        const [result] = assetInfo;

        let metadata = result?.minting_tx_metadata?.['721']?.[policyId]?.[hex];
        if (!metadata) {
            const assetName = Buffer.from(hex, 'hex').toString('utf-8');
            metadata = result?.minting_tx_metadata?.['721']?.[policyId]?.[assetName];
            if (!metadata && result?.token_registry_metadata) {
                metadata = { image: `data:image/png;base64,${result.token_registry_metadata.logo ?? ''}` };
            }
        }
        return metadata;
    }

    async getCip25AssetImage(policyId: string, hex: string): Promise<string | null> {
        const metadata = await this.getAssetMetadata(policyId, hex);
        if (!metadata) return null;

        let image = (metadata.image as string | string[] | null | undefined) ?? null;
        if (Array.isArray(image)) image = image.join('');
        return image;
    }

    async getBackgroundImageDetails(
        policyId: string,
        hex: string
    ): Promise<{ image: string; creatorDefaults?: ICreatorDefaults; metadata?: Record<string, unknown> }> {
        const updateHex =
            hex.startsWith(AssetNameLabel.LBL_222) || hex.startsWith(AssetNameLabel.LBL_444)
                ? `${AssetNameLabel.LBL_100}${hex.replace(AssetNameLabel.LBL_222, '').replace(AssetNameLabel.LBL_444, '')}`
                : hex;

        const datum = await this.getAssetDatum(policyId, updateHex);
        const metadata = await this.getAssetMetadata(policyId, hex);

        let image = '';
        if (metadata && metadata.image) image = metadata.image as string;

        if (datum) {
            return getImageDataFromDatum(this.config.apiHost ?? defaultApiHost(this.config.network), datum);
        }

        return { image, metadata };
    }

    async getAddressInfo(bech32Address: string): Promise<AddressInfo> {
        const result = (
            await this.fetchKoios<KoiosAddressInfo[]>(`/address_info`, 'POST', JSON.stringify({ _addresses: [bech32Address] }))
        )[0];

        const balance: Record<string, bigint> = {};
        result.utxo_set.forEach((utxo) => {
            (utxo.asset_list || []).forEach((asset) => {
                const { policy_id, asset_name, quantity } = asset;
                const unit = `${policy_id}${asset_name || ''}`;
                balance[unit] = (balance[unit] || BigInt(0)) + BigInt(quantity);
            });
        });
        const amount: { unit: string; quantity: string }[] = Object.entries(balance).reduce(
            (acc, cur) => [...acc, { unit: cur[0], quantity: cur[1].toString() }],
            [] as { unit: string; quantity: string }[]
        );

        return {
            address: result.address,
            amount: [{ unit: 'lovelace', quantity: result.balance }].concat(amount.sort((a, b) => (a.unit > b.unit ? 1 : -1))),
            stake_address: result.stake_address,
            script: result.script_address
        };
    }

    async getAddressUTxOs(bech32Address: string): Promise<ChainProviderAsset[]> {
        const result = await this.fetchKoios<KoiosTxOutput[]>(
            `/address_utxos`,
            'POST',
            JSON.stringify(buildKoiosAddressUtxoRequestBody(bech32Address))
        );

        const utxos: ChainProviderAsset[] = [];
        for (const output of result) {
            utxos.push(await this.buildChainProviderAsset(output));
        }
        return utxos;
    }
}
