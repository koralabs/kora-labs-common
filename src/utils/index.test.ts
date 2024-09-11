import { AssetNameLabel } from '../types';
import { checkNameLabel, getDateFromSlot, getDateStringFromSlot, getElapsedTime, getSlotNumberFromDate, isNumeric } from './';

describe('Utils Tests', () => {
    describe('getDateFromSlot Tests', () => {
        it('should return the correct date for the current slot on mainnet', () => {
            const currentSlot = 127856308;
            const result = getDateFromSlot(currentSlot);
            expect(new Date(result).toDateString()).toEqual('Wed Jun 26 2024');
        });

        it('should return the correct date for preview', () => {
            const currentSlot = 52766835;
            const result = getDateFromSlot(currentSlot, 'preview');
            expect(new Date(result).toDateString()).toEqual('Wed Jun 26 2024');
        });
    });
    
    describe('isNumeric', () => {
        it('should be numeric', () => {
            const isNumber = isNumeric('5');
            expect(isNumber).toBeTruthy();
        });
    });

    describe('getElapsedTime', () => {
        it('should get correct elapsed time', () => {
            const time = getElapsedTime(121000);
            expect(time).toEqual('2:01');
        });
    });
    

    describe('getDateStringFromSlot', () => {
        it('should get the correct date string from slot', () => {
            const date = getDateStringFromSlot(78200473);
            expect(date).toEqual(new Date('2025-04-17T02:21:13.000Z'));
        });
    });

    describe('getSlotNumberFromDate', () => {
        it('should get the correct date string from slot', () => {
            const date = getSlotNumberFromDate(new Date('2022-11-30T00:06:04.000Z'));
            expect(date).toEqual(78200473);
        });
    });

    describe('checkNameLabel', () => {
        it('should return the correct label for asset names', () => {
            const assetName222 = `${AssetNameLabel.LBL_222}${Buffer.from('burrito').toString('hex')}`;
            expect(checkNameLabel(assetName222)).toEqual({ assetLabel: '222', assetName: 'burrito', isCip67: true });

            const assetName000 = `${AssetNameLabel.LBL_000}${Buffer.from('burrito').toString('hex')}`;
            expect(checkNameLabel(assetName000)).toEqual({ assetLabel: '000', assetName: 'burrito', isCip67: true });

            const assetName001 = `${AssetNameLabel.LBL_001}${Buffer.from('burrito').toString('hex')}`;
            expect(checkNameLabel(assetName001)).toEqual({ assetLabel: '001', assetName: 'burrito', isCip67: true });
        });

        it('should return the correct label for 222', () => {
            const assetName = `${Buffer.from('burrito').toString('hex')}`;
            const label = checkNameLabel(assetName);
            expect(label).toEqual({ assetLabel: null, assetName: 'burrito', isCip67: false });
        });
    });

});
