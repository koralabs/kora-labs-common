export interface IOAuthRepo {
    getClient(clientId?: string | null): Promise<AuthClient>;
    getGrant(handle?:string | null, clientId?: string | null): Promise<AuthGrant>;
    setGrant(grant?: AuthGrant): Promise<void>;
    getPermissions(): Promise<FriendlyPermissions>
}

export interface AuthClient {
    clientId: string;
    clientSecretHash: string;
    scope: Permission[];
    approvalUri: string;
    failureUri: string;
    handle: string;
    applicationName: string;
    holderAddress: string;
}

export interface AuthGrant {
    clientId: string;
    scope: Permission[];
    requestId?: string;
    authCode?: string;
    handle?: string;
    holderAddress?: string;
    accessToken?: string;
    refreshToken?: string;
    issueDate?: number;
    clientState?: string;
    codeChallenge?: string;
    challengeMethod?: ChallengeMethod
    revokeReason?: string
}

export type Permission = 'subhandle.mint' | 'handles.login'

export type FriendlyPermissions = Record<string, string>

export type ChallengeMethod = 'sha256' | 'plain'