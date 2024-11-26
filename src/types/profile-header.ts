enum ProfileHeaderBannerImageTypes {
    "personalized_background" = "personalized_background",
    "circuit_board" = "circuit_board",
    "hidden" = "hidden",
    "asset" = "asset"
}

enum ProfileHeaderPFPImageTypes {
    "personalized_handle" = "personalized_handle",
    "pfp" = "pfp",
    "hidden" = "hidden",
    "asset" = "asset"
}

interface ProfileHeaderBannerSetting {
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

interface ProfileHeaderPFPSetting {
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

interface ProfileHeaderHandleNameSetting {
    hide?: boolean;
}

interface ProfileHeaderSetting {
    banner?: ProfileHeaderBannerSetting;
    pfp?: ProfileHeaderPFPSetting;
    handleName?: ProfileHeaderHandleNameSetting;
}

export type { ProfileHeaderBannerImageTypes, ProfileHeaderBannerSetting, ProfileHeaderPFPImageTypes, ProfileHeaderPFPSetting, ProfileHeaderSetting };
