import { ScriptDetails } from '../handles';
import { AssetNameLabel } from '../types';

export type NftAttributes = {
    name: string;
    image: string;
    [key: string]: string | number | boolean;
}

export interface IMarketplaceListingUTxO {
    tx_id: string;
    index: number;
    lovelace: number;
    datum?: string;
    address: string;
    script?: ScriptDetails;
}

export interface IMarketplaceListing {
    assetName: string;
    assetNameHex: string;
    assetLabel?: AssetNameLabel;
    policyId: string;
    nftAttributes?: NftAttributes;
    utxo: IMarketplaceListingUTxO;
    holder: string;
    price: number;
    payoutAddress: string;
    slotNumber: number
}