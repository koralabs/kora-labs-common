export const normalizeCategory = (category?: string): string =>
    category?.trim().toUpperCase() || 'INFO';

export const shouldPublishCategory = (category: string, allowList: string[]): boolean => {
    const normalizedCategory = normalizeCategory(category);
    const normalizedAllowList = allowList.map((item) => normalizeCategory(item));
    return normalizedAllowList.includes('*') || normalizedAllowList.includes(normalizedCategory);
};

export const buildEventName = (namespace: string, event: string): string => {
    const raw = `${namespace}.${event}`;
    return raw.replace(/\.+/g, '.').replace(/^\./, '').replace(/\.$/, '');
};

