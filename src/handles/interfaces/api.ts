import { HandleType, IHandleMetadata, IPersonalization, IPersonalizedHandle, IPzDatumConvertedUsingSchema, IReferenceToken, ISubHandleSettings, IUTxO } from '.';
import { Sort } from '../../types';

export interface SubHandleSettings {
    settings: ISubHandleSettings;
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
    subhandle_settings?: {
        settings?: string;
        utxo: IUTxO;
    };
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

export interface SaveMintingTxInput {
    hex: string;
    name: string;
    adaAddress: string;
    og_number: number;
    image: string;
    image_hash?: string;
    slotNumber: number;
    utxo: string;
    lovelace: number;
    svg_version?: string;
    bg_image?: string;
    pfp_image?: string;
    datum?: string;
    script?: { type: string; cbor: string };
    last_update_address?: string;
    personalization?: IPersonalization;
    reference_token?: IReferenceToken;
    resolved_addresses?: Record<string, string>;
    amount?: number;
    version?: number;
    handle_type: HandleType;
    sub_rarity?: string;
    sub_length?: number;
    sub_characters?: string;
    sub_numeric_modifiers?: string;
    virtual?: {
        expires_time: number;
        public_mint: boolean;
    };
    original_address?: string;
    id_hash?: string;
    pz_enabled?: boolean;
    last_edited_time?: number
    policy: string;
}

export interface SaveWalletAddressMoveInput {
    slotNumber: number;
    name: string;
    adaAddress: string;
    utxo: string;
    lovelace: number,
    policy: string;
    datum?: string;
    script?: { type: string; cbor: string };
}

export interface SavePersonalizationInput {
    slotNumber: number;
    hex: string;
    name: string;
    personalization: IPersonalization;
    policy: string;
    reference_token: IReferenceToken;
    personalizationDatum: IPzDatumConvertedUsingSchema | null;
    metadata: IHandleMetadata | null;
}

export interface SaveSubHandleSettingsInput {
    name: string;
    settingsDatum?: string;
    utxoDetails: IUTxO;
    slotNumber: number;
}

export interface Holder {
    address: string;
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

export interface IGetAllQueryParams {
    records_per_page?: string;
    page?: string;
    sort?: Sort;
    characters?: string;
    length?: string;
    rarity?: string;
    numeric_modifiers?: string;
    slot_number?: string;
    search?: string;
    holder_address?: string;
    personalized?: boolean;
    og?: 'true' | 'false';
    handle_type?: string;
    type: string;
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