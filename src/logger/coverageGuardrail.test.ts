import { buildEventName, normalizeCategory, shouldPublishCategory } from './coverageGuardrail';

describe('coverage guardrail helpers', () => {
    it('normalizeCategory uppercases and trims with default fallback', () => {
        expect(normalizeCategory(' warn ')).toBe('WARN');
        expect(normalizeCategory('')).toBe('INFO');
        expect(normalizeCategory(undefined)).toBe('INFO');
    });

    it('shouldPublishCategory allows wildcard and exact matches', () => {
        expect(shouldPublishCategory('error', ['*'])).toBe(true);
        expect(shouldPublishCategory('notify', ['WARN', 'NOTIFY'])).toBe(true);
        expect(shouldPublishCategory('info', ['WARN', 'ERROR'])).toBe(false);
    });

    it('buildEventName normalizes repeated and leading/trailing separators', () => {
        expect(buildEventName('mint', 'started')).toBe('mint.started');
        expect(buildEventName('mint.', '.started')).toBe('mint.started');
        expect(buildEventName('.', '.')).toBe('');
    });
});

