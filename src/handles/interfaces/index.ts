import { BoolInt, FeaturedItemType, HexString, HexStringOrEmpty } from '../../types';
import { ISlotHistory, StoredHandle } from './api';

export enum Rarity {
    basic = 'basic', // - 8-15 characters
    common = 'common', // - 4-7 characters
    rare = 'rare', // - 3 characters
    ultra_rare = 'ultra_rare', // - 2 characters
    legendary = 'legendary' // - 1 character
}

export interface SocialItem {
    display: string;
    url: string;
}

interface ISharedPzDesigner {
    pfp_border_color?: HexStringOrEmpty;
    qr_inner_eye?: string; // 'rounded,#0a1fd3';
    qr_outer_eye?: string; // 'square,#0a1fd3';
    qr_dot?: string; // 'dot,#0a1fd3';
    qr_bg_color?: HexStringOrEmpty; // '0x22d1af';
    qr_image?: string; // url or data:image;base64;
    pfp_zoom?: number; // 0.86;
    pfp_offset?: number[]; //[124, 58],
    font?: string; // 'Family Name,https://fonts.com/super_cool_font.woff';
    font_color?: HexStringOrEmpty; // "0x0a1fd3",
    font_shadow_size?: number[]; // [12, 12, 8],
    text_ribbon_colors?: HexStringOrEmpty[]; // ["0x0a1fd3", "22d1af", "31bc23"],
    text_ribbon_gradient?: string; // 'linear-45' | 'radial'
    socials_color?: HexStringOrEmpty; // "0a1fd3"
    circuit_color?: HexStringOrEmpty; // "0a1fd3ff"
}

export interface IPersonalizationDesigner extends ISharedPzDesigner {
    font_shadow_color?: HexStringOrEmpty;
    bg_color?: HexStringOrEmpty; // "0x0a1fd3"
    bg_border_color?: HexStringOrEmpty; //"0x0a1fd3"
    qr_link?: string;
    socials?: SocialItem[];
    creator_defaults_enabled?: BoolInt;
    custom_dollar_symbol?: BoolInt;
}

export interface ICreatorDefaults extends ISharedPzDesigner {
    bg_border_colors?: HexStringOrEmpty[]; // ["0x0a1fd3", "22d1af", "31bc23"],
    pfp_border_colors?: HexStringOrEmpty[]; // ["0x0a1fd3", "22d1af", "31bc23"],
    font_shadow_colors?: HexStringOrEmpty[]; // ["0x0a1fd3", "22d1af", "31bc23"],
    require_asset_collections?: HexStringOrEmpty[]; // ["0x<policy_id><asset_prefix>", "0x<other_policy_id>"],
    require_asset_attributes?: string[]; // ["Outerwear:Denim Jacket"],
    require_asset_displayed?: BoolInt; // true;
    price?: number; // 125;
    force_creator_settings?: BoolInt; // true;
    custom_dollar_symbol?: BoolInt; // true;
    circuit_colors?: HexStringOrEmpty[]; //  ["0a1fd3ff", "22d1af88", "31bc2399"]
}

export interface GallerySettings {
    include: string[];
    exclude: string[];
    align: 'center' | 'left' | 'right';
    groupBy: 'policy' | 'none';
    featured: FeaturedItemType[];
    sort: 'amount' | 'name';
    displayAmount: boolean;
    handleLink: 'asset' | 'portal';
}

export interface IPersonalizationPortal {
    type: string;
    domain?: string | null;
    custom_settings?: string[] | null;
    background_setting?: string | undefined | null;
    profile_header_setting?: string | null;
    gallery_setting?: string | null;
    text_setting?: string | null;
}

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
    HAL_ROYALTY_SPEND = 'hal_royalty_spend',
    // Aiken PZ Contracts
    PZ_PROXY = 'pz_proxy',
    PZ_GOVERNOR = 'pz_governor',
    PZ_ASSETS = 'pz_assets',
    BG_CONSTRAINTS = 'bg_constraints'
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

export interface IUTxO {
    tx_id: string;
    index: number;
    lovelace: number;
    datum?: string;
    address: string;
    script?: ScriptDetails;
}

export interface IReferenceToken extends IUTxO {}

export interface IPersonalization {
    portal?: IPersonalizationPortal;
    designer?: IPersonalizationDesigner;
    socials?: SocialItem[];
    validated_by: string;
    trial: boolean;
    nsfw: boolean;
}

export interface IHandle {
    hex: string;
    name: string;
    image: string;
    image_hash: string;
    standard_image: string;
    standard_image_hash: string;
    pfp_image?: string;
    pfp_asset?: string;
    bg_image?: string;
    bg_asset?: string;
    holder: string;
    holder_type: string;
    length: number;
    og_number: number;
    rarity: Rarity;
    characters: string; // 'letters,numbers,special',
    numeric_modifiers: string; // 'negative,decimal',
    default_in_wallet: string; // my_default_hndl
    resolved_addresses: {
        ada: string;
        [key: string]: string;
    };
    created_slot_number: number;
    updated_slot_number: number;
    last_edited_time?: number;
    utxo: string;
    lovelace: number;
    has_datum: boolean;
    datum?: string;
    script?: {
        type: string; // 'plutus_v2', etc
        cbor: string;
    };
    last_update_address?: string;
    svg_version: string;
    version: number;
    policy: string;
    handle_type: HandleType;
    virtual?: {
        expires_time: number;
        public_mint: boolean;
    };
    original_address?: string;
    pz_enabled?: boolean;
}

export interface ICip68Handle extends IHandle {
    reference_token?: IReferenceToken;
}

export interface IPersonalizedHandle extends ICip68Handle {
    personalization?: IPersonalization;
}

export enum HandleType {
    VIRTUAL_SUBHANDLE = 'virtual_subhandle',
    NFT_SUBHANDLE = 'nft_subhandle',
    HANDLE = 'handle'
}

export enum SubHandleType {
    VIRTUAL = 'virtual',
    NFT = 'nft'
}

export interface IHandleMetadata {
    name: string;
    image: string;
    mediaType: string;
    og: BoolInt;
    og_number: number;
    rarity: string;
    length: number;
    characters: string;
    numeric_modifiers: string;
    version: number;
    sub_rarity?: string;
    sub_length?: number;
    sub_characters?: string;
    sub_numeric_modifiers?: string;
    handle_type: HandleType;
}

export interface IPzDatum {
    virtual?: {
        expires_time: number;
        public_mint: BoolInt;
    };
    resolved_addresses?: {
        [key: string]: string;
    };
    standard_image: string; // ipfs://cid
    image_hash: HexStringOrEmpty; // sha256 checksum of custom handle jpeg
    standard_image_hash: HexStringOrEmpty; // sha256 checksum of standard_image jpeg
    bg_image?: string; // ipfs://cid
    pfp_image?: string; // ipfs://cid
    pfp_asset?: HexStringOrEmpty; // 0x<policy><assetName>
    bg_asset?: HexStringOrEmpty; // 0x<policy><assetName>
    last_edited_time?: number; // timestamp in milliseconds
    portal?: string;
    designer?: string; // ipfs://cid containing IPersonalizationDesigner
    socials?: string;
    vendor?: string;
    default: BoolInt;
    last_update_address: HexStringOrEmpty; // ByteArray, not Bech32
    validated_by: HexStringOrEmpty; // PubKeyHash
    trial: BoolInt;
    nsfw: BoolInt;
    svg_version: string;
    agreed_terms: string; //https://adahandle.com/tou
    migrate_sig_required: BoolInt;
    original_address?: HexStringOrEmpty;
    pz_enabled?: BoolInt;
    id_hash?: string;
}

/**
 * Comes from handleDatumSchema[2]
 */
export interface IPzDatumConvertedUsingSchema {
    standard_image: string;
    bg_image?: string;
    pfp_image?: string;
    pfp_asset?: HexStringOrEmpty; // 0x<policy><assetName>
    bg_asset?: HexStringOrEmpty; // 0x<policy><assetName>
    portal?: string;
    designer?: string;
    socials?: string;
    vendor?: string;
    default: boolean;
    last_edited_time?: number;
    resolved_addresses?: {
        ada: HexString;
        [key: string]: string;
    };
    migrate_sig_required: boolean;
    trial: boolean;
    nsfw: boolean;
    svg_version: string;
    virtual?: {
        expires_time: number;
        public_mint: boolean;
    };
    original_address?: HexString;
    id_hash?: HexString;
    agreed_terms: string;
    pz_enabled?: boolean;
    image_hash: HexStringOrEmpty; // sha256 checksum of custom handle jpeg
    standard_image_hash: HexStringOrEmpty; // sha256 checksum of standard_image jpe
    last_update_address: HexStringOrEmpty; // ByteArray, not Bech32
    validated_by: HexStringOrEmpty; // PubKeyHash
}

export interface ISubHandleSettingsDefaultStyles extends IPersonalizationDesigner {
    bg_image?: string;
}

/**
 *
 * Handle: sh_settings
 * [
 *   valid_contracts,
 *   admin_creds,
 *   virtual price,
 *   base price,
 *   buy_down_prices,
 *   payment address,
 *  expiry_duration
 * ]
 *
 */
export type ISubHandleAdminSettings = [
    HexString[], //valid_contracts
    HexString[], //admin_creds
    number, // virtual price
    number, // base price
    [number, number][], // buy_down_prices
    HexString, // payment address
    number //expiry_duration
];

export interface ISubHandleTypeSettings {
    public_minting_enabled?: boolean;
    pz_enabled?: boolean;
    tier_pricing?: [number, number][];
    default_styles?: ISubHandleSettingsDefaultStyles;
    save_original_address?: boolean;
}

export interface ISubHandleSettings {
    nft?: ISubHandleTypeSettings;
    virtual?: ISubHandleTypeSettings;
    buy_down_paid?: number; // how much they have paid to buy down
    buy_down_price?: number; // The current price they have paid for (we give the better price between the two),
    buy_down_percent?: number; // The current percentage they have paid for (we give the better price between the two),
    agreed_terms?: string;
    payment_address?: string;
    migrate_sig_required?: boolean;
}

export type ISubHandleSettingsItemDatumStruct = [
    BoolInt, // public_minting_enabled
    BoolInt, // pz_enabled
    [number, number][], // tier_pricing
    ISubHandleSettingsDefaultStyles,
    BoolInt // save_original_address
];

/**
 *
 * @property {ISubHandleSettingsDatumStruct} [0] - nft
 * @property {ISubHandleSettingsDatumStruct} [1] - virtual
 * @property {number} [2] - buy_down_price
 * @property {number} [3] - buy_down_paid
 * @property {number} [4] - buy_down_percent
 * @property {string} [5] - agreed_terms
 * @property {BoolInt} [6] - migrate_sig_required
 * @property {string} [7] - payment_address
 *
 */
export type ISubHandleSettingsDatumStruct = [
    ISubHandleSettingsItemDatumStruct,
    ISubHandleSettingsItemDatumStruct,
    number, // buy_down_price
    number, // buy_down_paid
    number, // buy_down_percent
    string, // agreed_terms
    BoolInt, // migrate_sig_required
    string // payment_address
];

export interface IHandleFileContent {
    slot: number;
    hash: string;
    schemaVersion?: number;
    handles: StoredHandle[];
    history: [number, ISlotHistory][];
}

export interface IHandleSvgOptions extends IPersonalizationDesigner {
    pfp_image?: string;
    pfp_asset?: string;
    bg_image?: string;
    bg_asset?: string;
    og_number?: number;
}

export interface PzSettings {
    treasury_fee: number; // lovelace
    treasury_cred: HexStringOrEmpty; // ValidatorKeyHashBytes
    pz_min_fee: number; // lovelace
    pz_providers: { [pubKeyHashBytes: HexString]: HexStringOrEmpty }; // { PubKeyHashBytes: ValidatorKeyHashBytes }
    valid_contracts: HexStringOrEmpty[]; // ValidatorKeyHashBytes[]
    admin_creds: HexStringOrEmpty[]; // PubKeyHashBytes[]
    settings_cred: HexStringOrEmpty; // ValidatorKeyHashBytes,
    grace_period: number; // seconds
    subhandle_share_percent: number; // percentage
}

/**
 *
 * @property {number} [0] - treasury_fee
 * @property {string} [1] - treasury_cred
 * @property {number} [2] - pz_min_fee
 * @property {[key: string]: string;} [3] - pz_providers
 * @property {string[]} [4] - valid_contracts
 * @property {string[]} [5] - admin_creds
 * @property {string} [6] - settings_cred
 * @property {number} [7] - grace_period
 * @property {number} [8] - subhandle_share_percent
 *
 */
export type IPzSettingsDatumStruct = [
    number, // treasury_fee
    string, // treasury_cred
    number, // pz_min_fee
    { [key: string]: string }, // pz_providers
    string[], // valid_contracts
    string[], // admin_creds
    string, // settings_cred
    number, // grace_period
    number // subhandle_share_percent
];

export interface ApprovedPolicies {
    [policyId: HexString]: {
        [patternMatch: HexString]: [number, number, number?]; // [nsfw, trial, price?]
    };
}

export enum OAuthSocial {
    'twitter',
    'facebook',
    'discord',
    'instagram',
    'tiktok',
    'youtube',
    'twitch',
    'linkedin',
    'snapchat',
    'telegram',
    'whatsapp',
    'medium',
    'github',
    'reddit',
    'pinterest',
    'pin',
    'spotify',
    'soundcloud',
    'paypal'
}

export interface OAuthToken {
    token: string;
    refresh_token: string;
    expiredAt: string;
}

export interface OAuthSocialToken extends OAuthToken {
    identifier: string;
    username: string;
    social: OAuthSocial;
}

export interface OAuthTokenMessage extends Partial<OAuthToken> {
    error?: string;
}

export interface ProtectedWord {
    word: string;
    algorithms: ('modifier' | 'badword' | 'suggestive' | 'hatespeech' | 'vulnerable')[];
    modType?: ('modifier' | 'suggestive' | 'hatespeech')[];
    canBePositive?: boolean;
    position?: 'exact' | 'any' | 'beginswith';
    exceptions?: string[];
}

export enum AvailabilityResponseCode {
    AVAILABLE = 200,
    ALREADY_CLAIMED = 403,
    NOT_AVAILABLE_FOR_LEGAL_REASONS = 451,
    NOT_ACCEPTABLE = 406,
    LOCKED = 423
}

export interface AvailabilityResponse {
    available: boolean;
    handle: string;
    message?: string;
    type?: 'notallowed' | 'invalid' | 'pending' | 'private';
    link?: string; //`https://${process.env.CARDANOSCAN_DOMAIN}/token/${policyID}.${assetName}`
    reason?: string;
    duration?: number;
    code: AvailabilityResponseCode;
    ogNumber?: number;
}

export interface ReservedOrProtected {
    reserved?: string[];
    protected: ProtectedWord[];
}

/**
 * Example: If you have 10 handles in your wallet, the new price is X
 *
 * {
 *  "0x{policyId}${assetName(optional)}": {
 *      10: 10,
 *      20: 20,
 *      30: 30
 *   }
 * }
 *
 */
export interface MintHandleDiscount {
    [policyAndAssetName: string]: {
        [ownedAmount: number]: number; // price;
    };
}

/**
 * Example: If you have 10 handles in your wallet, the new price is X
 *
 * [
 *   ['0x000000000000000000000000000000000000000000000000000000027465737433', [[1, 35000000],[1, 35000000]]],
 *   ['0x000000000000000000000000000000000000000000000000000000027465737431', [[2, 30000000]]],
 *   ['0x0000000000000000000000000000000000000000000000000000000274657374', [[4, 0]]]
 * ]
 *
 */
export type MintHandleDiscountArray = [string, [number, number]][];

export interface CollectionInfo {
    paymentAddress: string;
    referenceTokenAddress?: string;
    collectionName: string;
    collectionImage: string;
    royaltyAddress: string;
    royaltyPercentage: number;
    relatedPolicyIds: string[];
    nsfw: boolean;
}

export type MintConfig = [
    string, // fee address hex
    [
        number, // fee schedule price
        number // fee schedule amount. if the price is greater than or equal, change this amount
    ][]
];

export type MintHandleSettingsAsset = [
    string, // hex name,
    [string, number], // utxo, index
    number, // price
    number, // valid until timestamp
    MintHandleDiscount | MintHandleDiscountArray
];

export interface MintHandleSettingsDetails {
    collectionName: string;
    collectionImage: string;
    lastEditingContractHash: string;
    mintingPolicyId: string;
    relatedPolicyIds?: string[];
    contractVersion?: number;
    nsfw: boolean;
}

export type MintHandleSettings = [
    string, // payment address hex,
    string, // editing contract address hex
    MintHandleSettingsAsset[], // assets
    MintHandleSettingsDetails
];
