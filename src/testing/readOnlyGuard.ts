/**
 * Read-only wallet guard for MAINNET smoke suites.
 *
 * Wraps a real LiveWallet so it is physically unable to move funds: signTx / signTxs / submitTx
 * are recorded and THROWN. Everything else (getUtxos, signData for OAuth, ...) passes through.
 * A scope proves it reached the transaction by asserting `reachedSign()` — the app built a tx and
 * asked to sign it — and stops there.
 */
import type { LiveWallet } from './liveWallet';

export const FUND_MOVING_METHODS = ['signTx', 'signTxs', 'submitTx'] as const;
export const READ_ONLY_GUARD_ERROR = 'E2E_READONLY_GUARD';

export interface SignRequest {
    method: (typeof FUND_MOVING_METHODS)[number];
    at: number;
    /** The exact tx CBOR the app asked to sign (first tx for signTxs). Decode it to assert what would have been signed. */
    txCbor: string;
}

export interface ReadOnlyWallet {
    wallet: LiveWallet;
    signRequests: SignRequest[];
    reachedSign(): boolean;
    reset(): void;
    waitForSignRequest(timeoutMs: number, tick?: () => Promise<unknown>): Promise<boolean>;
}

const firstTxCbor = (params: unknown): string => {
    if (typeof params === 'string') return params;
    if (Array.isArray(params)) {
        const first = params[0] as string | { cbor?: string; tx?: string } | undefined;
        return typeof first === 'string' ? first : (first?.cbor ?? first?.tx ?? '');
    }
    return '';
};

export const makeReadOnlyWallet = (inner: LiveWallet): ReadOnlyWallet => {
    const signRequests: SignRequest[] = [];
    const guardedCall = async (method: string, params?: unknown): Promise<unknown> => {
        if ((FUND_MOVING_METHODS as readonly string[]).includes(method)) {
            signRequests.push({ method: method as SignRequest['method'], at: Date.now(), txCbor: firstTxCbor(params) });
            throw new Error(`${READ_ONLY_GUARD_ERROR}: '${method}' is blocked — this suite reaches the transaction and stops; it never signs or submits.`);
        }
        return inner.call(method, params);
    };
    return {
        wallet: { ...inner, call: guardedCall },
        signRequests,
        reachedSign: () => signRequests.length > 0,
        reset: () => {
            signRequests.length = 0;
        },
        waitForSignRequest: async (timeoutMs, tick) => {
            const start = Date.now();
            while (signRequests.length === 0 && Date.now() - start < timeoutMs) {
                if (tick) await tick();
                await new Promise((r) => setTimeout(r, 1500));
            }
            return signRequests.length > 0;
        }
    };
};
