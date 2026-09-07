import { ICreatorDefaults } from '../../handles/interfaces';

export interface ChainProviderAsset {
    address: string;
    amount: { unit: string; quantity: string }[];
    inline_datum: string | null;
    output_index: number;
    tx_hash: string;
    data_hash: string | null;
    reference_script_hash?: string | null;
    reference_script_cbor?: string | null;
}

export interface ChainProviderUtxo {
    outputs: ChainProviderAsset[];
}

export interface AccountAsset {
    asset: string;
    amount: string;
}

export interface AddressInfo {
    address: string;
    amount: { unit: string; quantity: string }[];
    stake_address?: string | null;
    script: boolean;
}

export interface BackgroundImageDetails {
    image: string;
    creatorDefaults?: ICreatorDefaults;
    metadata?: Record<string, unknown>;
}

/**
 * The unified read contract every chain provider (Koios, Blockfrost, …) implements. The failover
 * orchestrator only depends on this interface, so providers are hot-swappable and mutually redundant.
 */
export interface ChainProvider {
    name: string;
    getLatestTransactionForAsset(policyId: string, hex: string): Promise<string | null>;
    getLatestBlock(): Promise<{ height: number; slot: number; time: number }>;
    getAssets(policyId: string): Promise<{ policyId: string; hex: string }[]>;
    getAssetDatum(policyId: string, hex: string): Promise<string | null>;
    getCip25AssetImage(policyId: string, hex: string): Promise<string | null>;
    getRefScriptCbor(tx: string, policyId: string, hex: string): Promise<string>;
    getTxUtxos(tx: string): Promise<ChainProviderUtxo>;
    getAssetUtxo(policyId: string, hex: string): Promise<ChainProviderAsset | null>;
    getAssetsByStakeKey(stakeKey: string): Promise<AccountAsset[]>;
    getDatumFromHash(datumHash: string): Promise<string | null>;
    getBackgroundImageDetails(policyId: string, hex: string): Promise<BackgroundImageDetails>;
    getAddressInfo(bech32Address: string): Promise<AddressInfo>;
    getAddressUTxOs(bech32Address: string): Promise<ChainProviderAsset[]>;
}
