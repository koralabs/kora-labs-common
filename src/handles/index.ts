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

export * from './interfaces';
export * from './constants';
export * from './api';
export * from './policies';
export { buildMetadata } from './buildMetadata';
export { checkHandlePattern } from './validation';