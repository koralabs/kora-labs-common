export const delay = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

export const toLovelace = (adaAmount: number): number => adaAmount * 1000000;

export const toADA = (lovelaceAmount: number): number => lovelaceAmount / 1000000;

export const chunk = <T>(input: T[], size: number) => {
    return input.reduce<T[][]>((arr: T[][], item: T, idx: number) => {
        return idx % size === 0 ? [...arr, [item]] : [...arr.slice(0, -1), [...arr.slice(-1)[0], item]];
    }, []);
};

export const awaitForEach = async <T>(array: T[], callback: (item: T, index: number, array: T[]) => Promise<void>) => {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
};

// Used to execute Promises in order, but still async.
// Good for adding delay between API calls and you need the complete list of results when they all resolve
export const asyncForEach = async <T, U>(
    array: T[],
    callback: (item: T, index: number, array: T[]) => Promise<U>,
    delayInMilliseconds = 0
) => {
    const promises: Promise<U>[] = [];
    for (let index = 0; index < array.length; index++) {
        promises.push(callback(array[index], index, array));
        if (delayInMilliseconds > 0) {
            await delay(delayInMilliseconds);
        }
    }
    return Promise.all(promises);
};

export const isNumeric = (n: string) => {
    return !isNaN(parseFloat(n)) && isFinite(parseFloat(n));
};

export const isNullEmptyOrUndefined = (value: any) => {
    return (
        value == undefined ||
        value == null ||
        value == '' ||
        JSON.stringify(value) === '{}' ||
        JSON.stringify(value) === '[]'
    );
};

export const isAlphaNumeric = (str: string): boolean => {
    return /^[a-zA-Z0-9]+$/.test(str);
};

export const getDateFromSlot = (currentSlot: number, network?: string): number => {
    // TODO: Make this work for all networks
    //console.log(`preview slot date = ${new Date(currentSlot * 1000)}`)
    const currentNetwork = network ? network.toLowerCase() : process.env.NETWORK?.toLowerCase();
    if (currentNetwork == 'preview') return (1666656000 + currentSlot) * 1000;
    if (currentNetwork == 'preprod') return (1654041600 + currentSlot) * 1000;

    return (1596491091 + (currentSlot - 4924800)) * 1000;
};

export const getSlotNumberFromDate = (date: Date, network?: string): number => {
    const currentNetwork = network ? network.toLowerCase() : process.env.NETWORK?.toLowerCase();
    if (currentNetwork == 'preview') return Math.floor(date.getTime() / 1000) - 1666656000;
    if (currentNetwork == 'preprod') return Math.floor(date.getTime() / 1000) - 1654041600;

    // Ignore parens to show intent
    // prettier-ignore
    return (Math.floor(date.getTime() / 1000) - 1596491091) + 4924800;
};

export const getElapsedTime = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const mins = Math.floor(seconds / 60);
    return `${mins}:${(seconds - mins * 60).toString().padStart(2, '0')}`;
};

export const objectHasKeys = (o: any) => Object.keys(o).length === 0;
export const isEmpty = (obj: any) => [Object, Array].includes((obj || {}).constructor) && !Object.entries(obj || {}).length;
export const isObject = (o: any) => o != null && typeof o === 'object';
export const hasOwnProperty = (o: any, ...args: [v: PropertyKey]) => Object.prototype.hasOwnProperty.call(o, ...args);
export const isDate = (d: any) => d instanceof Date;
export const isEmptyObject = (o: any) => isObject(o) && objectHasKeys(o);
export const makeObjectWithoutPrototype = () => Object.create(null);

export const ExcludesFalse = <T>(n?: T | undefined | null): n is T => Boolean(n);

export const diff = (lhs: any, rhs: any) => {
    if (lhs === rhs) return {}; // equal return no diff

    if (!isObject(lhs) || !isObject(rhs)) return rhs; // return updated rhs

    const deletedValues = Object.keys(lhs).reduce((acc, key) => {
        if (!hasOwnProperty(rhs, key)) {
            acc[key] = undefined;
        }

        return acc;
    }, makeObjectWithoutPrototype());

    if (isDate(lhs) || isDate(rhs)) {
        if (lhs.valueOf() == rhs.valueOf()) return {};
        return rhs;
    }

    if (Array.isArray(lhs) || Array.isArray(rhs)) {
        if (lhs.length === rhs.length && JSON.stringify(lhs) === JSON.stringify(rhs)) return {}; // return no diff
        return rhs; // return updated rhs
    }

    return Object.keys(rhs).reduce((acc, key) => {
        if (!hasOwnProperty(lhs, key)) {
            acc[key] = rhs[key]; // return added r key
            return acc;
        }

        const difference = diff(lhs[key], rhs[key]);

        // If the difference is empty, and the lhs is an empty object or the rhs is not an empty object
        if (isEmptyObject(difference) && !isDate(difference) && (isEmptyObject(lhs[key]) || !isEmptyObject(rhs[key]))) return acc; // return no diff

        acc[key] = difference; // return updated key
        return acc; // return updated key
    }, deletedValues);
};

export const mapStringifyReplacer = (_key: any, value: any) => {
    if (value instanceof Map) {
        return Array.from(value.entries());
    } else {
        return value;
    }
}
export const mapNoKeysStringifyReplacer = (_key: any, value: any) => {
    if (value instanceof Map) {
        return Array.from(value.values());
    } else {
        return value;
    }
}

export { decodeCborToJson, encodeJsonToDatum, DefaultTextFormat as KeyType } from './cbor';

export * from './crypto';
