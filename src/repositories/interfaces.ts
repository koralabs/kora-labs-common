export interface IOAuthRepo {
    getClients(handle: string): Promise<AuthClient[]>;
    saveClient(authClient: AuthClient): Promise<void>;
    updateClient(clientId: string, updatedData: Partial<AuthClient>): Promise<void>;
    deleteClient(clientId: string): Promise<void>;
    deleteGrant(handle: string, clientId: string): Promise<void>;
    getClient(clientId?: string | null): Promise<AuthClient>;
    getGrant(handle?: string | null, clientId?: string | null): Promise<AuthGrant>;
    getAllGrants(handle?: string | null): Promise<AuthGrant[]>;
    setGrant(grant?: AuthGrant): Promise<void>;
    getPermissions(): Promise<FriendlyPermissions>;
    validateAccessToken(clientId: string, handle: string, accessToken: string): Promise<boolean>;
}

export interface AuthClient {
    clientId: string;
    clientSecretHash: string;
    scope: Permission[];
    projectDescription: string;
    projectName: string;
    approvalUri: string;
    failureUri: string;
    handle: string;
    holderAddress: string;
}

export interface AuthGrant {
    clientId: string;
    scope: Permission[];
    requestId?: string;
    authCode?: string;
    handle?: string;
    holderAddress?: string;
    projectName?: string;
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