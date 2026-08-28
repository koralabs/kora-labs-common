import { HANDLE_POLICIES } from './policies';

const STANDARD_POLICY_ID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
const DEMI_POLICY_ID = '6c32db33a422e0bc2cb535bb850b5a6e9a9572222056d6ddc9cbc26e';

describe('HANDLE_POLICIES', () => {
    it('finds the active standard policy for each supported network', () => {
        expect(HANDLE_POLICIES.getActivePolicy('mainnet', false, 1)).toBe(STANDARD_POLICY_ID);
        expect(HANDLE_POLICIES.getActivePolicy('preview', false, 1)).toBe(STANDARD_POLICY_ID);
        expect(HANDLE_POLICIES.getActivePolicy('preprod', false, 1)).toBe(STANDARD_POLICY_ID);
    });

    it('finds the active DeMi policy independently from the standard policy', () => {
        expect(HANDLE_POLICIES.getActivePolicy('mainnet', true, 1)).toBe(DEMI_POLICY_ID);
        expect(HANDLE_POLICIES.getActivePolicy('preview', true, 1)).toBe(DEMI_POLICY_ID);
        expect(HANDLE_POLICIES.getActivePolicy('preprod', true, 1)).toBe(DEMI_POLICY_ID);
    });

    it('returns undefined when no policy is active at the requested slot', () => {
        HANDLE_POLICIES.mainnet[STANDARD_POLICY_ID] = {
            ...HANDLE_POLICIES.mainnet[STANDARD_POLICY_ID],
            firstMintingSlot: 10,
            lastMintingSlot: 20
        };

        try {
            expect(HANDLE_POLICIES.getActivePolicy('mainnet', false, 9)).toBeUndefined();
            expect(HANDLE_POLICIES.getActivePolicy('mainnet', false, 21)).toBeUndefined();
            expect(HANDLE_POLICIES.getActivePolicy('mainnet', false, 10)).toBe(STANDARD_POLICY_ID);
            expect(HANDLE_POLICIES.getActivePolicy('mainnet', false, 20)).toBe(STANDARD_POLICY_ID);
        } finally {
            HANDLE_POLICIES.mainnet[STANDARD_POLICY_ID] = {
                ...HANDLE_POLICIES.mainnet[STANDARD_POLICY_ID],
                firstMintingSlot: 0,
                lastMintingSlot: null
            };
        }
    });

    it('checks policy membership within a specific network', () => {
        expect(HANDLE_POLICIES.contains('mainnet', STANDARD_POLICY_ID)).toBe(true);
        expect(HANDLE_POLICIES.contains('mainnet', DEMI_POLICY_ID)).toBe(true);
        expect(HANDLE_POLICIES.contains('mainnet', 'unknown-policy')).toBe(false);
    });
});
