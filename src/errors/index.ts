export class OauthAccessError extends Error {
    oauthErrorCode: string;
    constructor(
        message: string,
        oauthErrorCode:
            | 'invalid_request'
            | 'invalid_client'
            | 'invalid_grant'
            | 'unauthorized_client'
            | 'unsupported_grant_type'
            | 'invalid_scope'
    ) {
        super();
        this.message = message;
        this.oauthErrorCode = oauthErrorCode;
    }
}
