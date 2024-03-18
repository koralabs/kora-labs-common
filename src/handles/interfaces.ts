export enum Rarity {
    basic = 'basic', // - 8-15 characters
    common = 'common', // - 4-7 characters
    rare = 'rare', // - 3 characters
    ultra_rare = 'ultra_rare', // - 2 characters
    legendary = 'legendary' // - 1 character
}

export type BoolInt = 0 | 1;
export type HexString = `0x${string}`;
export type HexStringOrEmpty = HexString | '';

/**
 * The asset label is a string that is used to identify the asset type.
 * First, remove the first and last 0.
 * Next, use the first 4 characters as the hex and convert to decimal. https://www.rapidtables.com/convert/number/hex-to-decimal.html
 * Finally, use the decimal number and convert to CRC8. It should match the last 2 characters. https://crccalc.com/
 */
export enum AssetNameLabel {
    LABEL_000 = '00000000', // 0
    LABEL_001 = '00001070', // 001 // SubHandle Settings
    LABEL_100 = '000643b0', // 100
    LABEL_222 = '000de140', // 222
    LABEL_333 = '0014df10', // 333
    LABEL_444 = '001bc280' // 444
}

export interface KeyPair {
    key: string;
    value: any;
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

export interface IPersonalizationPortal {
    type: string;
    domain?: string | null;
    custom_settings?: string[] | null;
}

export interface ScriptDetails {
    handle: string;
    handleHex: string;
    refScriptUtxo?: string;
    refScriptAddress?: string;
    cbor?: string;
    unoptimizedCbor?: string;
    validatorHash: string;
    latest?: boolean;
}

export interface IReferenceToken {
    tx_id: string;
    index: number;
    lovelace: number;
    datum: string;
    address: string;
    script?: ScriptDetails;
}

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
        [key: string]: string;
    };
    created_slot_number: number;
    updated_slot_number: number;
    utxo: string;
    has_datum: boolean;
    datum?: string;
    script?: {
        type: string; // 'plutus_v2', etc
        cbor: string;
    };
    last_update_address?: string;
    svg_version: string;
    version: number;
}

export interface ICip68Handle extends IHandle {
    reference_token?: IReferenceToken;
}

export interface IPersonalizedHandle extends ICip68Handle {
    personalization?: IPersonalization;
}

export interface IHandleStats {
    percentage_complete: string;
    current_memory_used: number;
    ogmios_elapsed: string;
    building_elapsed: string;
    handle_count: number;
    slot_date: Date;
    memory_size: number;
    current_slot: number;
    current_block_hash: string;
    schema_version: number;
}

export enum HandleType {
    VIRTUAL_SUBHANDLE = 'virtual_subhandle',
    NFT_SUBHANDLE = 'nft_subhandle',
    HANDLE = 'handle'
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
    standard_image: string; // ipfs://cid
    image_hash: HexStringOrEmpty; // sha256 checksum of custom handle jpeg
    standard_image_hash: HexStringOrEmpty; // sha256 checksum of standard_image jpeg
    bg_image?: string; // ipfs://cid
    pfp_image?: string; // ipfs://cid
    pfp_asset?: HexStringOrEmpty; // 0x<policy><assetName>
    bg_asset?: HexStringOrEmpty; // 0x<policy><assetName>
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
    resolved_addresses?: {
        [key: string]: string;
    };
}

export interface ISubHandleSettings {
    enabled?: BoolInt;
    tierPricing?: [number, number][];
    enablePz?: BoolInt;
    creatorDefaults?: ICreatorDefaults;
    creatorDefaultsBgImage?: string;
}

export interface IVirtualSubHandleSettings extends ISubHandleSettings {
    expires_in_days?: number;
}

export interface ISubHandleSettingsDatum {
    nft?: ISubHandleSettings;
    virtual?: IVirtualSubHandleSettings;
}

export interface IHandleFileContent {
    slot: number;
    hash: string;
    schemaVersion?: number;
    handles: Record<string, IPersonalizedHandle>;
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
    settings_cred: HexStringOrEmpty; // ValidatorKeyHashBytes
}

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
    identifier: string;
    username: string;
    token: string;
    refresh_token: string;
    expiredAt: string;
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
    cost?: number | 'n/a';
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
