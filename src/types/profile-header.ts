export enum ProfileHeaderBannerImageTypes {
    personalized_background = "personalized_background",
    circuit_board = "circuit_board",
    hidden = "hidden",
    asset = "asset"
}

export enum ProfileHeaderPFPImageTypes {
    personalized_handle = "personalized_handle",
    pfp = "pfp",
    hidden = "hidden",
    asset = "asset"
}

export interface ProfileHeaderBannerSetting {
    image?: string;
    asset?: {
        unit: string;
        url: string;
    };
    crop?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface ProfileHeaderPFPSetting {
    image?: string;
    asset?: {
        unit: string;
        url: string;
    };
    crop?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface ProfileHeaderHandleNameSetting {
    hide?: boolean;
}

export interface ProfileHeaderSetting {
    banner?: ProfileHeaderBannerSetting;
    pfp?: ProfileHeaderPFPSetting;
    handleName?: ProfileHeaderHandleNameSetting;
}
