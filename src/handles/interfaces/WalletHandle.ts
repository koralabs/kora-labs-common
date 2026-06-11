// Browser-safe wallet/asset contracts (handle.me#938). Self-contained — NO runtime/backend
// imports — so ESM consumers like @koralabs/handles-shared-lit-components can use them (via
// `import type`) without the CJS/ESM interop break the package's heavier modules would cause.
// These canonicalize the duplicated local shapes in handles-shared-lit-components.

export interface BasicAsset {
    policyId: string;
    hex: string;
}

export interface Asset extends BasicAsset {
    name: string;
    count?: number;
    utxo?: string;
    image?: string;
    src?: string;
    price?: number;
    cost?: number;
    validUntilDate?: number;
}

export interface WalletHandle extends Asset {
    // `active` was `any` in shared-lit's local dupe and is not read by the shared components;
    // `unknown` here keeps it in the contract while forcing consumers to narrow it explicitly.
    active: unknown;
    default: boolean;
    image?: string;
    imageUrl?: string;
}
