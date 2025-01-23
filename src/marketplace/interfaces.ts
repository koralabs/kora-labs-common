import { IUTxO } from '../handles';
import { AssetNameLabel } from '../types';

export type NftAttributes = {
    name: string;
    image: string;
    [key: string]: string | number | boolean;
}

export interface IPayout {
    address: string;
    lovelace: number;
}

export interface IMarketplaceListing {
    asset_name: string;
    asset_name_hex: string;
    image: string;
    asset_label?: AssetNameLabel;
    policy_id: string;
    nft_attributes?: NftAttributes;
    utxo: IUTxO;
    holder: string;
    price: number;
    payouts: IPayout[];
    slot_number: number;
}

export interface PayoutStruct {
    [constructor: string]: [string, number]; // [address, lovelace]
}

export interface MarketplaceListingDatumScript {
    constructor_0: [PayoutStruct[], string]; // [payouts, ownerHash]
}