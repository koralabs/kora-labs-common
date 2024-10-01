import { IUTxO } from '../handles';
import { AssetNameLabel } from '../types';

export type NftAttributes = {
    name: string;
    image: string;
} & {
    [key: string]: string | number | boolean;
}

export interface IMarketplaceListing {
    assetName: string;
    assetNameHex: string;
    assetLabel: AssetNameLabel;
    policyId: string;
    nftAttributes: NftAttributes;
    utxo: IUTxO;
    holder: string;
    price: bigint;
}