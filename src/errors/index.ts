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

export class ModelException extends Error {
    public message: string;

    constructor(message: string) {
        super(message);
        this.message = message;
    }
}

export class HttpException extends Error {
    public status: number;
    public message: string;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.message = message;
    }
}
