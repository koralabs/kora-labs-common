import { HandleType, IHandleMetadata } from './interfaces';
import { REGEX_SUB_HANDLE, RESPONSE_AVAILABLE, RESPONSE_INVALID_HANDLE_FORMAT, RESPONSE_UNAVAILABLE_LEGENDARY } from './constants';
import { Rarity } from './interfaces';

export const getRarity = (name: string): Rarity => {
    const length = name.length;
    if (1 === length) {
        return Rarity.legendary;
    }

    if (2 === length) {
        return Rarity.ultra_rare;
    }

    if (3 === length) {
        return Rarity.rare;
    }

    if (length > 3 && length < 8) {
        return Rarity.common;
    }

    return Rarity.basic;
};

const buildCharacters = (name: string): string => {
    const characters: string[] = [];

    if (/[a-z]+/.test(name)) {
        characters.push('letters');
    }

    if (/[0-9]+/.test(name)) {
        characters.push('numbers');
    }

    if (/[_\-.]+/.test(name)) {
        characters.push('special');
    }

    return characters.join(',');
};

const buildNumericModifiers = (name: string): string => {
    const modifiers: string[] = [];

    if (/^-?[0-9]\d*(\.\d+)?$/.test(name)) {
        if (name.startsWith('-')) {
            modifiers.push('negative');
        }

        if (name.includes('.')) {
            modifiers.push('decimal');
        }
    }

    return modifiers.join(',');
};

export const buildMetadata = ({
    handleName,
    handleType,
    cid,
    ogNumber
}: {
    handleName: string;
    handleType: HandleType;
    cid: string;
    ogNumber?: number;
}) => {
    const isSubHandle = handleName.includes('@');
    const [subHandleName, rootHandleName] = handleName.split('@');
    let metadata: IHandleMetadata = {
        name: `$${handleName}`,
        image: `ipfs://${cid}`,
        mediaType: 'image/jpeg',
        og: isSubHandle ? 0 : ogNumber ? 1 : 0,
        og_number: isSubHandle ? 0 : ogNumber ?? 0,
        rarity: getRarity(rootHandleName ?? handleName),
        length: handleName.length,
        characters: buildCharacters(rootHandleName ?? handleName),
        numeric_modifiers: buildNumericModifiers(rootHandleName ?? handleName),
        handle_type: handleType,
        version: 1
    };

    if (isSubHandle) {
        metadata = {
            ...metadata,
            sub_rarity: getRarity(subHandleName),
            sub_length: subHandleName.length,
            sub_characters: buildCharacters(subHandleName),
            sub_numeric_modifiers: buildNumericModifiers(subHandleName)
        };
    }

    return metadata;
};

export const checkHandlePattern = (handle: string, root?: string) => {
    handle = handle.toLowerCase();

    if (handle.length <= 1) {
        return {
            valid: false,
            message: RESPONSE_UNAVAILABLE_LEGENDARY
        };
    }

    if (!handle.match(REGEX_SUB_HANDLE) && (root ? handle.endsWith(`@${root}`) : true)) {
        return {
            valid: false,
            message: RESPONSE_INVALID_HANDLE_FORMAT
        };
    }

    return {
        valid: true,
        message: RESPONSE_AVAILABLE
    };
};