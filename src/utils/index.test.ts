import { getDateFromSlot } from './';

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
});
