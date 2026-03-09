export enum ScriptType {
    PZ_CONTRACT = 'pers',
    SUB_HANDLE_SETTINGS = 'subh',
    MARKETPLACE_CONTRACT = 'mkpl',
    // De-Mi
    DEMI_MINT_PROXY = 'demimntprx',
    DEMI_MINT = 'demimnt',
    DEMI_MINTING_DATA = 'demimntmpt',
    DEMI_ORDERS = 'demiord',
    // H.A.L. mint
    HAL_MINT_PROXY = 'halmntprx',
    HAL_MINT = 'halmnt',
    HAL_MINTING_DATA = 'halmntmpt',
    HAL_ORDERS_SPEND = 'halord',
    HAL_REF_SPEND_PROXY = 'halrefprx',
    HAL_REF_SPEND = 'halref',
    HAL_ROYALTY_SPEND = 'halroy'
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
