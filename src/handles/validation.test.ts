import { checkHandlePattern } from './validation';

describe('validation tests', () => {
    it('should return true', () => {
        const result = checkHandlePattern('...');
        expect(result).toBe(null);
    });
});
