// policy featured
interface PolicyFeaturedItem {
    type: 'policy';
    hex: string;
    name?: string;
    image?: string;
    sort: string;
    fileIndex?: number;
    attributeFilter: string[];
    featuredTokens: string[];
}

// separator featured
interface SeparatorFeaturedItem {
    type: 'separator';
}

// asset featured
interface AssetFeaturedItem {
    type: 'asset';
    hex: string;
    fileIndex?: number;
}

type FeaturedItemType = PolicyFeaturedItem | SeparatorFeaturedItem | AssetFeaturedItem;

export { PolicyFeaturedItem, SeparatorFeaturedItem, AssetFeaturedItem, FeaturedItemType };
