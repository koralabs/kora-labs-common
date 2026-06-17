import { IndexNames, LockedLambdaReason, UTxOFunctionName } from './api';

describe('handles API interface enums', () => {
    it('keeps UTxO function names aligned with API store method names', () => {
        expect(UTxOFunctionName.ADD_UTXO).toBe('addUtxo');
        expect(UTxOFunctionName.UPDATE_HOLDER_INDEX).toBe('updateHolderIndex');
        expect(UTxOFunctionName.UPDATE_HANDLE_INDEXES).toBe('updateHandleIndexes');
    });

    it('keeps lambda lock reasons stable for persisted metrics', () => {
        expect(LockedLambdaReason.REINDEX).toBe('REINDEX');
        expect(LockedLambdaReason.SCANNING).toBe('SCANNING');
        expect(LockedLambdaReason.ROLLBACK).toBe('ROLLBACK');
        expect(LockedLambdaReason.ROLLBACK_2160).toBe('ROLLBACK_2160');
        expect(LockedLambdaReason.ROLLBACK_20).toBe('ROLLBACK_20');
        expect(LockedLambdaReason.UTXO_IMPORT).toBe('UTXO_IMPORT');
        expect(LockedLambdaReason.UNLOCKED).toBe('');
    });

    it('keeps index names stable for API store persistence', () => {
        expect(IndexNames.ADDRESS).toBe('address');
        expect(IndexNames.DEFAULT_HANDLE).toBe('defaulthandle');
        expect(IndexNames.HANDLE_TYPE).toBe('handle_type');
        expect(IndexNames.HASH_OF_STAKE_KEY_HASH).toBe('hashofstakekeyhash');
        expect(IndexNames.PAYMENT_KEY_HASH).toBe('paymentkeyhashes');
        expect(IndexNames.SUBHANDLE).toBe('subhandle');
        expect(IndexNames.UTXO_SLOT).toBe('utxo_slot');
    });
});
