import { Network } from '../types';
import { getSlotNumberFromDate } from '../utils';

export interface PolicyIds {
    [key: string]: {
        firstMintingSlot: number;
        lastMintingSlot: number | null;
        sunsetSlot: number | null;
        isDeMi?: boolean;
    }
}

export interface HandlePolicies {
    'preview': PolicyIds;
    'preprod': PolicyIds;
    'mainnet': PolicyIds;
    getActivePolicy(network: Network, isDemi?: boolean, atSlot?:number): string | undefined;
    contains(network: Network, policyId: string): boolean;
}

export const HANDLE_POLICIES: HandlePolicies = {
    'preview': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null}
    },
    'preprod': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null}
    },
    'mainnet': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null}
    },
    
    getActivePolicy(network: Network, isDeMi = false, atSlot?:number) {
        const theSlot = atSlot ? atSlot : getSlotNumberFromDate(new Date(Date.now()));
        return Object.entries(this[network]).find(([, value]) => 
            value.firstMintingSlot <= theSlot && (value.lastMintingSlot ?? Number.POSITIVE_INFINITY) >= theSlot && value.isDeMi == isDeMi
        )?.[0]
    },

    contains(network: Network, policyId: string) {
        return Object.keys(this[network]).includes(policyId);
    }
};