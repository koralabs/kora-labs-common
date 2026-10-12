/**
 * Wallet behaviour controls for live suites: make the live wallet act the way a user or a wallet
 * extension does at a given moment, without changing what it signs or submits.
 *
 *   - `withWalletControls`: one-shot "the user declines the next signature" and "the wallet submits,
 *     then reports a failure" (a relay-backed wallet that times out after forwarding the tx).
 *   - `makeUnsignedWallet`: read methods only — even CIP-8 signData is refused (validation runs that
 *     must not sign anything). For mainnet use `makeReadOnlyWallet`, which also records the requests.
 */
import type { LiveWallet } from './liveWallet';

/** Every read method the page bridge exposes. Anything else signs or submits. */
export const WALLET_READ_METHODS = [
    'getUtxos',
    'getCollateral',
    'getBalance',
    'getNetworkId',
    'getRewardAddresses',
    'getChangeAddress',
    'getUsedAddresses',
    'getUnusedAddresses',
    'getExtensions',
    'getPubDRepKey'
] as const;

export const UNSIGNED_WALLET_ERROR = 'E2E_UNSIGNED_WALLET';
export const USER_DECLINED_MESSAGE = 'User declined to sign the transaction.';

export interface WalletControls {
    wallet: LiveWallet;
    /** The next signTx / signTxs is declined the way a user declines in the wallet popup. */
    declineNextSignature(message?: string): void;
    /**
     * The next successful submitTx really submits (and is tracked) and then throws `message`, with the
     * CIP-30 TxSendError shape (code 2 = Failure) relay wallets report.
     */
    throwAfterNextSubmit(message: string): void;
}

const cip30Error = (message: string, code: number) => Object.assign(new Error(message), { code, info: message });

export const withWalletControls = (inner: LiveWallet): WalletControls => {
    let declineMessage: string | null = null;
    let submitThrowMessage: string | null = null;
    const call = async (method: string, params?: unknown): Promise<unknown> => {
        if ((method === 'signTx' || method === 'signTxs') && declineMessage !== null) {
            const message = declineMessage;
            declineMessage = null;
            // CIP-30 TxSignError code 2 = UserDeclined.
            throw cip30Error(message, 2);
        }
        const result = await inner.call(method, params);
        if (method === 'submitTx' && submitThrowMessage !== null) {
            const message = submitThrowMessage;
            submitThrowMessage = null;
            console.log(`[wallet submitTx] submitted ${String(result)}, now throwing (relay-timeout simulation)`);
            throw cip30Error(message, 2);
        }
        return result;
    };
    return {
        wallet: { ...inner, call },
        declineNextSignature: (message = USER_DECLINED_MESSAGE) => {
            declineMessage = message;
        },
        throwAfterNextSubmit: (message) => {
            submitThrowMessage = message;
        }
    };
};

/** A wallet that answers read methods only; every other method (signTx, signData, submitTx, ...) throws. Unknown methods fail closed. */
export const makeUnsignedWallet = (inner: LiveWallet): LiveWallet => ({
    ...inner,
    call: async (method, params) => {
        if (!(WALLET_READ_METHODS as readonly string[]).includes(method)) {
            throw new Error(`${UNSIGNED_WALLET_ERROR}: '${method}' is forbidden in this validation run.`);
        }
        return inner.call(method, params);
    }
});
