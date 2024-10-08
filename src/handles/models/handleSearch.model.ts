import { HandleType, Rarity } from '..';
import { ModelException } from '../../errors';
import { isNumeric } from '../../utils';

interface HandleSearchInput {
    characters?: string;
    length?: string;
    rarity?: string;
    numeric_modifiers?: string;
    search?: string;
    holder_address?: string;
    personalized?: boolean;
    handle_type?: string;
    og?: string;
    handles?: string[];
}

export class HandleSearchModel {
    private _characters?: string;
    private _length?: string;
    private _rarity?: string;
    private _numeric_modifiers?: string;
    private _search?: string;
    private _holder_address?: string;
    private _personalized?: boolean;
    private _handle_type?: string;
    private _og?: boolean;
    private _handles?: string[];

    constructor(input?: HandleSearchInput) {
        const { characters, length, rarity, numeric_modifiers, search, holder_address, og, personalized, handle_type, handles } = input ?? {};
        this.characters = characters;
        this.length = length;
        this.rarity = rarity;
        this.numeric_modifiers = numeric_modifiers;
        this.search = search;
        this.holder_address = holder_address;
        this.personalized = personalized;
        this.handle_type = handle_type;
        this.og = og === 'true';
        this.handles = handles;
    }

    get characters() {
        return this._characters;
    }

    set characters(value) {
        const validCharacters = ['letters', 'numbers', 'special'];
        if (value && !validCharacters.some((v) => value.split(',').includes(v))) {
            throw new ModelException(`characters must be ${validCharacters.join(', ')}`);
        }

        this._characters = value;
    }

    get rarity() {
        return this._rarity;
    }

    set rarity(value) {
        const validRarity = Object.values(Rarity);
        if (value && !validRarity.some((v) => value.split(',').includes(v))) {
            throw new ModelException(`rarity must be ${validRarity.join(', ')}`);
        }
        this._rarity = value;
    }

    get handle_type() {
        return this._handle_type;
    }

    set handle_type(value) {
        const validHandleType = Object.values(HandleType);
        if (value && !validHandleType.some((v) => value.split(',').includes(v))) {
            throw new ModelException(`handle_type must be ${validHandleType.join(', ')}`);
        }
        this._handle_type = value;
    }

    get length() {
        return this._length;
    }

    set length(value) {
        const lengthMErrorMsg = "Length must be a number or a range of numbers (ex: 1-28) and can't exceed 28";
        if (!value) {
            this._length = value;
            return;
        }
        let minLength = value;
        let maxLength = value;
        if (value?.includes('-')) {
            minLength = value.split('-')[0];
            maxLength = value.split('-')[1];
        }
        if (!isNumeric(minLength) || !isNumeric(maxLength)) {
            throw new ModelException(lengthMErrorMsg);
        }

        if (parseInt(minLength) > 28 || parseInt(maxLength) > 28) {
            throw new ModelException(lengthMErrorMsg);
        }

        if (parseInt(minLength) > parseInt(maxLength)) {
            throw new ModelException('Invalid length range');
        }
        this._length = value;
    }

    get numeric_modifiers() {
        return this._numeric_modifiers;
    }

    set numeric_modifiers(value) {
        const validModifiers = ['negative', 'decimal'];
        if (value && !validModifiers.some((v) => value.split(',').includes(v))) {
            throw new ModelException(`numeric_modifiers must be ${validModifiers.join(', ')}`);
        }

        this._numeric_modifiers = value;
    }

    get search() {
        return this._search;
    }

    set search(value) {
        if (value && value.length < 3) {
            throw new ModelException('search must be at least 3 characters');
        }
        this._search = value;
    }

    get holder_address() {
        return this._holder_address;
    }

    set holder_address(value) {
        this._holder_address = value;
    }

    get personalized() {
        return this._personalized;
    }

    set personalized(value) {
        this._personalized = value;
    }

    get og() {
        return this._og;
    }

    set og(value) {
        this._og = value;
    }

    get handles() {
        return this._handles;
    }

    set handles(value) {
        if (value && !Array.isArray(value)) {
            throw new ModelException(`expected array and received ${typeof value}`);
        }
        this._handles = value;
    }
}
