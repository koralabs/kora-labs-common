import { AssetNameLabel } from '../types';
import {
    buildUserIssueEventKey,
    checkNameLabel,
    createUserIssueTrackingId,
    getDateFromSlot,
    getDateStringFromSlot,
    getElapsedTime,
    getSlotNumberFromDate,
    isNumeric,
    isUserIssueTrackingId,
    normalizeUserIssueEventSegment
} from './';

describe('Utils Tests', () => {
    describe('getDateFromSlot Tests', () => {
        it('should return the correct date for the current slot on mainnet', () => {
            const currentSlot = 127856308;
            const result = getDateFromSlot(currentSlot);
            expect(new Date(result).toUTCString()).toContain('Wed, 26 Jun 2024');
        });

        it('should return the correct date for preview', () => {
            const currentSlot = 52766835;
            const result = getDateFromSlot(currentSlot, 'preview');
            expect(new Date(result).toUTCString()).toContain('Wed, 26 Jun 2024');
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
            expect(date).toEqual(new Date('2022-11-30T00:06:04.000Z'));
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
            expect(checkNameLabel(assetName222)).toEqual({ assetLabel: AssetNameLabel.LBL_222, name: 'burrito', isCip67: true });

            const assetName000 = `${AssetNameLabel.LBL_000}${Buffer.from('burrito').toString('hex')}`;
            expect(checkNameLabel(assetName000)).toEqual({ assetLabel: AssetNameLabel.LBL_000, name: 'burrito', isCip67: true });

            const assetName001 = `${AssetNameLabel.LBL_001}${Buffer.from('burrito').toString('hex')}`;
            expect(checkNameLabel(assetName001)).toEqual({ assetLabel: AssetNameLabel.LBL_001, name: 'burrito', isCip67: true });
        });

        it('should return the correct label for 222', () => {
            const assetName = `${Buffer.from('burrito').toString('hex')}`;
            const label = checkNameLabel(assetName);
            expect(label).toEqual({ assetLabel: AssetNameLabel.NONE, name: 'burrito', isCip67: false });
        });
    });

    describe('user issue tracking id', () => {
        it('should build deterministic tracking id when timestamp/random are provided', () => {
            const timestamp = 1700000000000;
            const id = createUserIssueTrackingId({ timestamp, random: () => 0 });
            expect(id).toEqual(`UI-${Math.floor(timestamp).toString(36)}-000000`);
        });

        it('should validate generated tracking id format', () => {
            const id = createUserIssueTrackingId({ timestamp: 1700000000000, random: () => 0.5 });
            expect(isUserIssueTrackingId(id)).toEqual(true);
        });

        it('should reject invalid tracking id formats', () => {
            expect(isUserIssueTrackingId('UI-abc-12345')).toEqual(false);
            expect(isUserIssueTrackingId('ui-abc-123456')).toEqual(false);
            expect(isUserIssueTrackingId('UI-ABC-123456')).toEqual(false);
        });
    });

    describe('user issue event key normalization', () => {
        it('should normalize event segments to safe tokens', () => {
            expect(normalizeUserIssueEventSegment('Handle.Me Mint/Search Exists Pay Modal')).toEqual(
                'handle_me_mint_search_exists_pay_modal'
            );
            expect(normalizeUserIssueEventSegment('  submit-tx  ')).toEqual('submit_tx');
        });

        it('should build deterministic user issue event key', () => {
            expect(
                buildUserIssueEventKey(
                    'handle.me',
                    'mint',
                    'Search Exists Pay Modal',
                    'submit-tx'
                )
            ).toEqual('user_issue.handle_me.mint.search_exists_pay_modal.submit_tx');
        });

        it('should use unknown for empty normalized segments', () => {
            expect(buildUserIssueEventKey('', 'mint', '!!!', 'submit-tx')).toEqual(
                'user_issue.unknown.mint.unknown.submit_tx'
            );
        });
    });
});
