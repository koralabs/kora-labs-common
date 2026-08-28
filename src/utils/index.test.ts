import { AssetNameLabel } from '../types';
import {
    asyncForEach,
    awaitForEach,
    buildUserIssueEventKey,
    checkNameLabel,
    chunk,
    createUserIssueTrackingId,
    diff,
    getDateFromSlot,
    getElapsedTime,
    getSlotNumberFromDate,
    hasOwnProperty,
    isAlphaNumeric,
    isDate,
    isEmpty,
    isEmptyObject,
    isNullEmptyOrUndefined,
    isNumeric,
    isObject,
    isUserIssueTrackingId,
    makeObjectWithoutPrototype,
    mapNoKeysStringifyReplacer,
    mapStringifyReplacer,
    normalizeUserIssueEventSegment,
    objectHasKeys,
    toADA,
    toLovelace
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

        it('should return the correct date for preprod', () => {
            const currentSlot = 117334474;
            const result = getDateFromSlot(currentSlot, 'preprod');
            expect(new Date(result).toISOString()).toEqual('2026-03-09T00:54:34.000Z');
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
        it('should get the correct preprod date string from slot', async () => {
            const originalNetwork = process.env.NETWORK;
            process.env.NETWORK = 'PREPROD';
            jest.resetModules();

            const { getDateStringFromSlot } = await import('./');
            const date = getDateStringFromSlot(117334474);

            expect(date).toEqual(new Date('2026-03-09T00:54:34.000Z'));
            process.env.NETWORK = originalNetwork;
        });
    });

    describe('getSlotNumberFromDate', () => {
        it('should get the correct date string from slot', () => {
            const date = getSlotNumberFromDate(new Date('2022-11-30T00:06:04.000Z'));
            expect(date).toEqual(78200473);
        });

        it('should get the correct preprod slot from date', () => {
            const date = getSlotNumberFromDate(new Date('2026-03-09T00:54:34.000Z'), 'preprod');
            expect(date).toEqual(117334474);
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

    describe('numeric conversions and collection helpers', () => {
        it('converts between ADA and lovelace', () => {
            expect(toLovelace(1.5)).toEqual(1500000);
            expect(toADA(2500000)).toEqual(2.5);
        });

        it('chunks arrays while preserving item order and trailing partial chunks', () => {
            expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
            expect(chunk([], 3)).toEqual([]);
        });

        it('awaits each callback in sequence', async () => {
            const source = ['a', 'b', 'c'];
            const calls: string[] = [];
            await awaitForEach(source, async (item, index, array) => {
                calls.push(index + ':' + item + ':' + (array === source));
            });

            expect(calls).toEqual(['0:a:true', '1:b:true', '2:c:true']);
        });

        it('collects async callback results and honors the delayed branch', async () => {
            const source = [1, 2, 3];
            const calls: string[] = [];
            const results = await asyncForEach(
                source,
                async (item, index, array) => {
                    calls.push(index + ':' + item + ':' + (array === source));
                    return item * 10;
                },
                1
            );

            expect(calls).toEqual(['0:1:true', '1:2:true', '2:3:true']);
            expect(results).toEqual([10, 20, 30]);
        });
    });

    describe('primitive and object predicates', () => {
        it('checks empty/nullish and alphanumeric values', () => {
            expect(isNullEmptyOrUndefined(undefined)).toEqual(true);
            expect(isNullEmptyOrUndefined(null)).toEqual(true);
            expect(isNullEmptyOrUndefined('')).toEqual(true);
            expect(isNullEmptyOrUndefined({})).toEqual(true);
            expect(isNullEmptyOrUndefined([])).toEqual(true);
            expect(isNullEmptyOrUndefined(0)).toEqual(true);
            expect(isNullEmptyOrUndefined('value')).toEqual(false);

            expect(isAlphaNumeric('abc123')).toEqual(true);
            expect(isAlphaNumeric('abc-123')).toEqual(false);
        });

        it('identifies object shapes used by diff', () => {
            const emptyWithoutPrototype = makeObjectWithoutPrototype();

            expect(objectHasKeys({ a: 1 })).toEqual(true);
            expect(isEmpty({})).toEqual(true);
            expect(isEmpty([1])).toEqual(false);
            expect(isObject({})).toEqual(true);
            expect(isObject(null)).toEqual(false);
            expect(hasOwnProperty({ a: 1 }, 'a')).toEqual(true);
            expect(isDate(new Date())).toEqual(true);
            expect(isEmptyObject({ a: null, b: undefined })).toEqual(true);
            expect(isEmptyObject({ a: 0 })).toEqual(false);
            expect(Object.getPrototypeOf(emptyWithoutPrototype)).toBeNull();
        });
    });

    describe('diff', () => {
        it('returns only nested additions, deletions, and replacements', () => {
            const dateAfter = new Date('2024-01-02T00:00:00.000Z');
            const result = diff(
                {
                    unchanged: 'same',
                    removed: 'old',
                    nested: { same: true, changed: 1 },
                    arr: [1, 2],
                    date: new Date('2024-01-01T00:00:00.000Z')
                },
                {
                    unchanged: 'same',
                    nested: { same: true, changed: 2 },
                    arr: [1, 3],
                    date: dateAfter,
                    added: 'new'
                }
            );

            expect(hasOwnProperty(result, 'unchanged')).toEqual(false);
            expect(hasOwnProperty(result, 'removed')).toEqual(true);
            expect(result.removed).toBeUndefined();
            expect(result.nested.changed).toEqual(2);
            expect(hasOwnProperty(result.nested, 'same')).toEqual(false);
            expect(result.arr).toEqual([1, 3]);
            expect(result.date).toBe(dateAfter);
            expect(result.added).toEqual('new');
        });

        it('returns an empty diff for equal dates and arrays', () => {
            const date = new Date('2024-01-01T00:00:00.000Z');

            expect(diff(date, new Date(date))).toEqual({});
            expect(diff([1, 2], [1, 2])).toEqual({});
            expect(diff('old', 'new')).toEqual('new');
        });
    });

    describe('map stringify replacers', () => {
        it('serializes maps with and without keys', () => {
            const value = { map: new Map<string, number>([['one', 1], ['two', 2]]) };

            expect(JSON.stringify(value, mapStringifyReplacer)).toEqual(JSON.stringify({ map: [['one', 1], ['two', 2]] }));
            expect(JSON.stringify(value, mapNoKeysStringifyReplacer)).toEqual(JSON.stringify({ map: [1, 2] }));
        });
    });

    describe('user issue tracking id edge cases', () => {
        it('clamps timestamp and random samples into valid base36 ranges', () => {
            const samples = [-1, Number.NaN, 1, 0.9999999999, 0.5, 1 / 36];
            let index = 0;

            const id = createUserIssueTrackingId({
                timestamp: -1.8,
                random: () => samples[index++]
            });

            expect(id).toEqual('UI-0-00zzi1');
        });
    });
});
