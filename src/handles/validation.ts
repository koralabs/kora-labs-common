import { REGEX_SUB_HANDLE, RESPONSE_AVAILABLE, RESPONSE_INVALID_HANDLE_FORMAT, RESPONSE_UNAVAILABLE_LEGENDARY } from "./constants";

export const checkHandlePattern = (handle: string, root?: string) => {
    handle = handle.toLowerCase();
    
    if (handle.length <= 1) {
        return {
            valid: false,
            message: RESPONSE_UNAVAILABLE_LEGENDARY
        };
    }
    
    if (!!handle.match(REGEX_SUB_HANDLE) && root ? handle.endsWith(`@${root}`) : true) {
        return {
            valid: false,
            message: RESPONSE_INVALID_HANDLE_FORMAT
        };
    }

    return {
        valid: true,
        message: RESPONSE_AVAILABLE
    };

}