// policy featured
export interface PolicyFeaturedItem {
    type: "policy";
    hex: string;
    name?: string;
    image?: string;
    sort: string;
    fileIndex?: number;
    attributeFilter: string[];
    featuredTokens: string[];
}

// separator featured
export interface SeparatorFeaturedItem {
    type: "separator";
}

// asset featured
export interface AssetFeaturedItem {
    type: "asset";
    hex: string;
    fileIndex?: number;
    link?: string;
}

export type FeaturedItemType = PolicyFeaturedItem | SeparatorFeaturedItem | AssetFeaturedItem;
