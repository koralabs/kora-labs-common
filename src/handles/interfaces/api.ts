import { IPersonalizedHandle, ISubHandleSettings, IUTxO } from '.';
import { Sort } from '../../types';

export interface SubHandleSettings extends ISubHandleSettings {
    utxo: IUTxO;
}

export interface StoredHandle extends IPersonalizedHandle {
    amount: number;
    default?: boolean;
    id_hash?: string;
    pz_enabled?: boolean;
    resolved_addresses: {
        ada: string;
        [key: string]: string;
    };
    payment_key_hash: string;
    subhandle_settings?: SubHandleSettings;
    sub_rarity?: string;
    sub_length?: number;
    sub_characters?: string;
    sub_numeric_modifiers?: string;
    virtual?: {
        expires_time: number;
        public_mint: boolean;
    };
    original_address?: string;
    drep?: IDrep
}

export interface IDrep {
    type: 'drep' | 'cc_hot' | 'cc_cold',
    cred: 'key' | 'script',
    hex: string,
    cip_105: string,
    cip_129: string
}

export interface HandleHistory {
    old: Partial<StoredHandle> | null;
    new?: Partial<StoredHandle> | null;
}

export interface ISlotHistory {
    [handleHex: string]: HandleHistory;
}

export interface IApiMetrics {
    firstSlot?: number;
    lastSlot?: number;
    currentSlot?: number;
    elapsedOgmiosExec?: number;
    elapsedBuildingExec?: number;
    firstMemoryUsage?: number;
    currentBlockHash?: string;
    tipBlockHash?: string;
    memorySize?: number;
    networkSync?: number;
    count?: number;
    schemaVersion?: number;
}

export interface Holder {
    handles: Set<string>;
    defaultHandle: string;
    manuallySet: boolean;
    type: string;
    knownOwnerName: string;
}

export interface HolderViewModel {
    total_handles: number;
    address: string;
    type: string;
    known_owner_name: string;
    default_handle: string;
    manually_set: boolean;
}

export interface IHandleSearchParams {
    characters?: string;
    length?: string;
    rarity?: string;
    numeric_modifiers?: string;
    search?: string;
    holder_address?: string;
    personalized?: boolean;
    handle_type?: string;
    public_subhandles?: boolean;
    og?: 'true' | 'false';
}

export interface IHandleSearchInput extends IHandleSearchParams {
    handles?: string[];
}

export interface IGetAllQueryParams extends IHandleSearchParams {
    records_per_page?: string;
    page?: string;
    sort?: Sort;
    slot_number?: string;
    type?: 'bech32stake' | 'holder' | 'stakekeyhash' | 'assetname' | 'handlehex' | 'paymentkeyhash' | 'bech32address' | 'hexaddress' 
}

export type ISearchBody = string[];

export interface IGetAllHoldersQueryParams {
    records_per_page?: string;
    page?: string;
    sort?: Sort;
}

export interface IGetHandleRequest {
    handle: string;
}

export interface IGetHolderAddressDetailsRequest {
    address: string;
}

export type INormalizedQueryParams = {
    [key: string]: string;
}

export enum IndexNames {
    ADDRESS = 'address',
    CHARACTER = 'characters',
    HANDLE = 'handle',
    HASH_OF_STAKE_KEY_HASH = 'hashofstakekeyhash',
    HOLDER = 'holder',
    LENGTH = 'length',
    NUMERIC_MODIFIER = 'numericmodifiers',
    OG = 'og',
    PAYMENT_KEY_HASH = 'paymentkeyhashes',
    RARITY = 'rarity',
    SLOT_HISTORY = 'slothistory',
    SUBHANDLE = 'subhandle',
    STAKE_KEY_HASH = 'stakekeyhash',
}