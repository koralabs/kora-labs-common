import { HandleType, IHandleMetadata } from './interfaces';
import { getRarity } from './getRarity';

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
