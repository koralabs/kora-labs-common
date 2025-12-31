export enum ScriptType {
    PZ_CONTRACT = 'pz_contract',
    SUB_HANDLE_SETTINGS = 'sub_handle_settings',
    MARKETPLACE_CONTRACT = 'marketplace_contract',
    // De-Mi
    DEMI_MINT_PROXY = 'demi_mint_proxy',
    DEMI_MINT = 'demi_mint',
    DEMI_MINTING_DATA = 'demi_minting_data',
    DEMI_ORDERS = 'demi_orders',
    // H.A.L. mint
    HAL_MINT_PROXY = 'hal_mint_proxy',
    HAL_MINT = 'hal_mint',
    HAL_MINTING_DATA = 'hal_minting_data',
    HAL_ORDERS_SPEND = 'hal_orders_spend',
    HAL_REF_SPEND_PROXY = 'hal_ref_spend_proxy',
    HAL_REF_SPEND = 'hal_ref_spend',
    HAL_ROYALTY_SPEND = 'hal_royalty_spend'
}

export interface ScriptDetails {
    handle: string;
    handleHex: string;
    refScriptUtxo?: string;
    refScriptAddress?: string;
    datumCbor?: string;
    cbor?: string;
    unoptimizedCbor?: string;
    validatorHash: string;
    latest?: boolean;
    type: ScriptType;
    txBuildVersion?: number;
}