/**
 * Bridges a Node-side `LiveWallet` into browser pages as `window.cardano[walletKey]`.
 *
 * The bridge is exposed at BROWSER-CONTEXT level so it also exists on cross-origin pages the flow
 * navigates to (e.g. auth.handle.me OAuth), not just the first origin. Typed structurally so this
 * module does not depend on @playwright/test.
 */
import type { LiveWallet } from './liveWallet';

export interface PageLike {
    context(): { exposeFunction(name: string, callback: (...args: any[]) => unknown): Promise<void> };
    addInitScript(script: { content: string }): Promise<void>;
}

export interface InstallWalletOptions {
    walletKey?: string;
    walletName?: string;
}

export const DEFAULT_WALLET_KEY = 'handleLiveE2E';
export const DEFAULT_WALLET_NAME = 'Handle Live E2E';
export const BRIDGE_FUNCTION = '__liveCip30Call';
const WALLET_ICON =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Ccircle cx="12" cy="12" r="10" fill="%234da965"/%3E%3C/svg%3E';

/** Browser-side init script. Exported so it can be exercised without a browser. */
export const buildCip30InitScript = ({ walletKey = DEFAULT_WALLET_KEY, walletName = DEFAULT_WALLET_NAME }: InstallWalletOptions = {}) => `
(function() {
    const call = async (method, params) => {
        if (typeof window.${BRIDGE_FUNCTION} !== 'function') throw new Error('${BRIDGE_FUNCTION} bridge not available');
        return JSON.parse(await window.${BRIDGE_FUNCTION}(method, JSON.stringify(params === undefined ? null : params)));
    };
    const api = {
        getUtxos: () => call('getUtxos'),
        getCollateral: (params) => call('getCollateral', params),
        getBalance: () => call('getBalance'),
        getNetworkId: () => call('getNetworkId'),
        getRewardAddresses: () => call('getRewardAddresses'),
        getChangeAddress: () => call('getChangeAddress'),
        getUsedAddresses: () => call('getUsedAddresses'),
        getUnusedAddresses: () => call('getUnusedAddresses'),
        getExtensions: () => call('getExtensions'),
        signTx: (tx) => call('signTx', tx),
        signData: (addr, payload) => call('signData', { addr, payload }),
        submitTx: (tx) => call('submitTx', tx),
        cip95: { getPubDRepKey: () => call('getPubDRepKey') },
        cip103: { signTxs: (txs) => call('signTxs', txs) }
    };
    const cardano = (window.cardano = window.cardano || {});
    cardano[${JSON.stringify(walletKey)}] = {
        name: ${JSON.stringify(walletName)},
        icon: ${JSON.stringify(WALLET_ICON)},
        apiVersion: '1.1.0',
        supportedExtensions: [{ cip: 8 }, { cip: 95 }, { cip: 103 }],
        isEnabled: async () => true,
        enable: async () => api
    };
})();
`;

/** Node side of the bridge: JSON in, JSON out (so errors and bigints never cross as live objects). */
export const createBridgeHandler = (wallet: LiveWallet) => async (method: string, paramsJson: string) =>
    JSON.stringify(await wallet.call(method, JSON.parse(paramsJson)));

export const installLiveCip30Wallet = async (page: PageLike, wallet: LiveWallet, options: InstallWalletOptions = {}) => {
    try {
        await page.context().exposeFunction(BRIDGE_FUNCTION, createBridgeHandler(wallet));
    } catch (error) {
        // A reused context already has the binding; anything else is a real failure.
        if (!/has been already registered/i.test((error as Error).message)) throw error;
    }
    await page.addInitScript({ content: buildCip30InitScript(options) });
};
