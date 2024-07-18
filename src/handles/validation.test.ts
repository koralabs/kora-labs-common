import { checkHandlePattern } from './validation';

describe('validation tests', () => {
    it('should return true', () => {
        const result = checkHandlePattern('...');
        expect(result).toEqual({ message: 'Yay! This handle is available.', valid: true });
    });
    it('should return false', () => {
        const result = checkHandlePattern('***');
        expect(result).toEqual({
            message: 'Invalid handle. Only a-z, 0-9, dash (-), underscore (_), and period (.) are allowed.',
            valid: false
        });
    });
    it('should return true for SubHandle', () => {
        const result = checkHandlePattern('aaaaaaaaaaaaaaaaaaaaaaaaa@tt');
        expect(result).toEqual({ message: 'Yay! This handle is available.', valid: true });
    });
});
