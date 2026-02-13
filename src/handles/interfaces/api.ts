import { HandleType, IPersonalizedHandle, ISubHandleSettings, MintingData, Rarity } from '.';
import { IMarketplaceListing } from '../../marketplace/interfaces';
import { Sort } from '../../types';
import { UTxO, UTxOWithTxInfo } from '../UTxO';

export interface SortAndLimitOptions {
    start?: number;
    end?: number;
    limit?: {
        offset: number;
        count: number;
    };
    orderBy?: Sort;
    isAlpha?: boolean;
}

export enum UTxOFunctionName {
    ADD_UTXO = 'addUtxo',
    UPDATE_HOLDER_INDEX = 'updateHolderIndex',
    UPDATE_HANDLE_INDEXES = 'updateHandleIndexes'
}

export enum LockedLambdaReason {
    REINDEX = 'REINDEX',
    SCANNING = 'SCANNING',
    ROLLBACK = 'ROLLBACK',
    ROLLBACK_2160 = 'ROLLBACK_2160',
    ROLLBACK_20 = 'ROLLBACK_20',
    UNLOCKED = '',
}

export type UTxOFunctions = {
    [UTxOFunctionName.ADD_UTXO]: (utxo: UTxOWithTxInfo) => void;
    [UTxOFunctionName.UPDATE_HANDLE_INDEXES]: (utxo: UTxOWithTxInfo, mintingData?: Map<string, MintingData[]>, handles?: Map<string, StoredHandle>, holders?: Map<string, HolderHandleNames>) => void;
};

export interface IApiStore {
    // SETUP
    initialize: () => IApiStore;
    destroy: () => void;
    rollBackToGenesis: () => void;
    pipeline: (commands: CallableFunction) => ApiIndexType | ApiIndexType[] | void;
    getStartingPoint: (utxoFunctions: UTxOFunctions, failed: boolean) => Promise<{ slot: number; id: string } | null>;

    // BASIC INDEXES
    getValueFromIndex(index: IndexNames, key: string | number): string | undefined;
    setValueOnIndex(index: IndexNames, key: string | number, value: string): void;

    // HASH INDEXES
    getIndex: (index: IndexNames, options?: SortAndLimitOptions) => Map<string | number, ApiIndexType>;
    getKeysFromIndex: (index: IndexNames, options?: SortAndLimitOptions) => (string | number)[];
    getHashFromIndex: (index: IndexNames, key: string | number) => ApiIndexType | undefined;
    setHashOnIndex: (index: IndexNames, key: string | number, value: ApiIndexType) => void;
    removeKeyFromIndex: (index: IndexNames, key: string | number) => void;

    // SET INDEXES
    getValuesFromIndexedSet: (index: IndexNames, key: string | number, options?: SortAndLimitOptions) => Set<string> | undefined;
    addValueToIndexedSet: (index: IndexNames, key: string | number, value: string) => void;
    removeValueFromIndexedSet: (index: IndexNames, key: string | number, value: string) => void;

    // ORDERED INDEXES
    getValuesFromOrderedSet: (index: IndexNames, ordinal: number, options?: SortAndLimitOptions) => ApiIndexType[] | undefined;
    addValueToOrderedSet: (index: IndexNames, ordinal: number, value: string | ISlotHistory) => void;
    removeValuesFromOrderedSet: (index: IndexNames, keyOrOrdinal: string | number) => void;

    // METRICS
    getMetrics: () => IApiMetrics;
    setMetrics: (metrics: IApiMetrics) => void;
    count: () => number;
    getIndexSchemaVersion: () => number;
    getUTxOSchemaVersion: () => number;
}

export interface SubHandleSettings extends ISubHandleSettings {
    utxo?: UTxO;
    utxo_id?: string;
}

export type ApiIndexType = Set<string> | Holder | ISlotHistory | StoredHandle | IMarketplaceListing | string | UTxOWithTxInfo | MintingData[];

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
    drep?: IDrep;
}

export interface IDrep {
    type: 'drep' | 'cc_hot' | 'cc_cold';
    cred: 'key' | 'script';
    hex: string;
    cip_105: string;
    cip_129: string;
}

export interface HandleUTxOHistory {
    old: UTxOWithTxInfo | null;
    new?: UTxOWithTxInfo | null;
}

export interface ListingHistory {
    old: Partial<IMarketplaceListing> | null;
    new?: Partial<IMarketplaceListing> | null;
}

export interface ISlotHistory {
    [handleHex: string]: HandleUTxOHistory | ListingHistory;
}

export interface IApiMetrics {
    firstSlot?: number;
    lastSlot?: number;
    currentSlot?: number;
    currentBlockHash?: string;
    tipBlockHash?: string;
    firstMemoryUsage?: number;
    memorySize?: number;
    networkSync?: number;
    handleCount?: number;
    holderCount?: number;
    utxoSchemaVersion?: number;
    indexSchemaVersion?: number;
    startTimestamp?: number;
    lockLambdas?: LockedLambdaReason;
    lockLambdasTimestamp?: number;
    lastMaxRollbackCheck?: number;
}

export type HolderHandleNames = Set<string>;

export interface DefaultHandleInfo {
    name: string;
    og_number: number;
    created_slot_number: number;
}

export interface Holder {
    handles: string[];
    total_handles: number;
    address: string;
    default_handle: string;
    manually_set: boolean;
    type: string;
    known_owner_name: string;
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
    minting_type?: 'nft' | 'virtual';
    type?: 'bech32stake' | 'holder' | 'stakekeyhash' | 'assetname' | 'handlehex' | 'paymentkeyhash' | 'bech32address' | 'hexaddress';
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
};

export enum IndexNames {
    ADDRESS = 'address',
    CHARACTER = 'characters',
    DEFAULT_HANDLE = 'defaulthandle',
    HANDLE = 'handle',
    HANDLE_TYPE = 'handle_type',
    HASH_OF_STAKE_KEY_HASH = 'hashofstakekeyhash',
    HOLDER = 'holder',
    HOLDER_COUNT = 'holdercount',
    LENGTH = 'length',
    LISTINGS = 'listings',
    MINT = 'mint',
    NUMERIC_MODIFIER = 'numericmodifiers',
    OG = 'og',
    PAYMENT_KEY_HASH = 'paymentkeyhashes',
    PERSONALIZED = 'personalized',
    RARITY = 'rarity',
    SLOT = 'slot',
    SUBHANDLE = 'subhandle',
    UTXO = 'utxo',
    UTXO_SLOT = 'utxo_slot',
}

export type CharacterAttribute = 'letters' | 'numbers' | 'special' | 'letters,numbers' | 'numbers,special' | 'letters,special' | 'letters,numbers,special';
export type NumericModifiersAttribute = 'negative' | 'decimal' | 'negative,decimal' | '';
