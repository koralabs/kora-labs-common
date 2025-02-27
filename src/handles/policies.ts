import { Network } from '../types';
import { getSlotNumberFromDate } from '../utils';

export const HANDLE_POLICIES = {
    'preview': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null, isDeMi: false}
    },
    'preprod': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null, isDeMi: false}
    },
    'mainnet': {
        'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a': {firstMintingSlot: 0, lastMintingSlot: null, sunsetSlot: null, isDeMi: false}
    },
    
    getActivePolicy(network: Network, atSlot?:number, isDeMi = false) {
        const theSlot = atSlot ? atSlot : getSlotNumberFromDate(new Date(Date.now()));
        return Object.entries(this[network]).find(([, value]) => 
            value.firstMintingSlot <= theSlot && (value.lastMintingSlot ?? Number.POSITIVE_INFINITY) >= theSlot && value.isDeMi == isDeMi
        )?.[0]
    }
};