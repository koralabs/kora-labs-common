import { HandleType, IPersonalizedHandle, ISubHandleSettings, IUTxO, Rarity } from '.';
import { IMarketplaceListing } from '../../marketplace/interfaces';
import { Sort } from '../../types';

export interface IApiStore {
    // SETUP
    initialize: () => Promise<IApiStore>;
    destroy: () => void;
    rollBackToGenesis: () => void;
    getStartingPoint: (
        save: (handle: StoredHandle) => void, 
        failed: boolean
    ) => Promise<{ slot: number; id: string; } | null>

    // INDEXES
    getIndex: (index:IndexNames, limit?: {offset: number, count: number}, sort?: Sort) => Map<string|number, ApiIndexType>;
    getKeysFromIndex: (index:IndexNames, limit?: {offset: number, count: number}, sort?: Sort) => (string|number)[];
    getValueFromIndex: (index:IndexNames, key:string|number) => ApiIndexType | undefined;
    setValueOnIndex: (index:IndexNames, key: string|number, value: ApiIndexType) => void;
    removeKeyFromIndex: (index:IndexNames, key: string|number) => void;

    // SET INDEXES
    getValuesFromIndexedSet: (index:IndexNames, key: string|number, limit?: {offset: number, count: number}, sort?: Sort) => Set<string> | undefined;
    addValueToIndexedSet: (index:IndexNames, key: string|number, value: string) => void;
    removeValueFromIndexedSet: (index:IndexNames, key: string|number, value: string) => void;
        
    // METRICS
    getMetrics: () => IApiMetrics;
    setMetrics: (metrics: IApiMetrics) => void;
    count: () => number;
    getSchemaVersion: () => number;
}

export interface SubHandleSettings extends ISubHandleSettings {
    utxo: IUTxO;
}

export type ApiIndexType = Set<string> | Holder | ISlotHistory | StoredHandle | IMarketplaceListing | string;

export interface StoredHandle extends IPersonalizedHandle {
    amount: number;
    default?: boolean;
    id_hash?: string;
    payment_key_hash: string;
    subhandle_settings?: SubHandleSettings;
    sub_rarity?: string;
    sub_length?: number;
    sub_characters?: string;
    sub_numeric_modifiers?: string;
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

export interface ListingHistory {
    old: Partial<IMarketplaceListing> | null;
    new?: Partial<IMarketplaceListing> | null;
}

export interface ISlotHistory {
    [handleHex: string]: HandleHistory | ListingHistory;
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

export interface DefaultHandleInfo {
    name: string;
    og_number: number;
    created_slot_number: number;
}
export interface Holder {
    handles: DefaultHandleInfo[];
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
    characters?: CharacterAttribute;
    length?: string;
    rarity?: Rarity;
    numeric_modifiers?: NumericModifiersAttribute;
    search?: string;
    holder_address?: string;
    personalized?: boolean;
    handle_type?: HandleType;
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
    minting_type?: 'nft' | 'virtual'
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
    LISTINGS = 'listings',
    NUMERIC_MODIFIER = 'numericmodifiers',
    OG = 'og',
    PAYMENT_KEY_HASH = 'paymentkeyhashes',
    PERSONALIZED = 'personalized',
    RARITY = 'rarity',
    SLOT = 'slot',
    SLOT_HISTORY = 'slothistory',
    SUBHANDLE = 'subhandle',
    HANDLE_TYPE = 'handle_type'
}

export type CharacterAttribute = 'letters' | 'numbers' | 'special' | 'letters,numbers' | 'numbers,special' | 'letters,special' | 'letters,numbers,special';
export type NumericModifiersAttribute = 'negative' | 'decimal' | 'negative,decimal' | ''