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

/**
 * Current protocol parameters in Blockfrost's `/epochs/latest/parameters` field names (Koios's
 * `/epoch_params` uses the same names and reports identical values; its `cost_models` is mapped to
 * `cost_models_raw`). Cost models are ledger-ordered arrays keyed `PlutusV1`/`PlutusV2`/`PlutusV3`.
 * `@koralabs/kora-labs-common/txBuild` `protocolParametersFromChain` turns this into tx-builder params.
 */
export interface ChainProtocolParameters {
    epoch: number;
    min_fee_a: number;
    min_fee_b: number;
    max_tx_size: number;
    coins_per_utxo_size: string;
    key_deposit: string;
    price_mem: number;
    price_step: number;
    max_tx_ex_mem: string;
    max_tx_ex_steps: string;
    min_fee_ref_script_cost_per_byte: number | null;
    cost_models_raw: Record<string, number[]>;
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
    /** The tx's outputs. Rejects with `status: 404` when the tx is not on chain (not in a block yet). */
    getTxUtxos(tx: string): Promise<ChainProviderUtxo>;
    getAssetUtxo(policyId: string, hex: string): Promise<ChainProviderAsset | null>;
    getAssetsByStakeKey(stakeKey: string): Promise<AccountAsset[]>;
    getDatumFromHash(datumHash: string): Promise<string | null>;
    getBackgroundImageDetails(policyId: string, hex: string): Promise<BackgroundImageDetails>;
    getAddressInfo(bech32Address: string): Promise<AddressInfo>;
    /** Every unspent output at the address (all pages). An address with no UTxOs has none. */
    getAddressUTxOs(bech32Address: string): Promise<ChainProviderAsset[]>;
    getProtocolParameters(): Promise<ChainProtocolParameters>;
    /**
     * The tx that spent output `txHash#outputIndex`, or null while it is unspent. Rejects with
     * `status: 404` when that output does not exist (e.g. the tx is not in a block yet).
     */
    getTxOutputConsumer(txHash: string, outputIndex: number): Promise<string | null>;
    /**
     * The asset's `onchain_metadata` as Blockfrost reports it (CIP-68 reference datum converted per
     * `cip68OnchainMetadata`, else the CIP-25 721 entry), or null when it has none.
     */
    getAssetOnchainMetadata(policyId: string, hex: string): Promise<Record<string, unknown> | null>;
}
