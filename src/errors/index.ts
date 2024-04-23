export class OauthAccessError extends Error {
    constructor(message: string)
    {
        super();
        this.message = message;
    }
}
