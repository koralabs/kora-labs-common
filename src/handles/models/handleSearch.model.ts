import { HandleType, IHandleSearchInput, Rarity } from '..';
import { ModelException } from '../../errors';
import { isNumeric } from '../../utils';

export class HandleSearchModel implements IHandleSearchInput {
    public characters?: string;
    public length?: string;
    public rarity?: string;
    public numeric_modifiers?: string;
    public search?: string;
    public holder_address?: string;
    public personalized?: boolean;
    public handle_type?: string;
    public og?: 'true' | 'false';
    public handles?: string[];

    constructor(input?: IHandleSearchInput) {
        for (const key in input) {
            (this as any)[key] = (input as any)[key];
        }
        
        const validCharacters = ['letters', 'numbers', 'special'];
        if (this.characters && !validCharacters.some((v) => this.characters!.split(',').includes(v))) {
            throw new ModelException(`characters must be ${validCharacters.join(', ')}`);
        }
        
        const validRarity = Object.values(Rarity);
        if (this.rarity && !validRarity.some((v) => this.rarity!.split(',').includes(v))) {
            throw new ModelException(`rarity must be ${validRarity.join(', ')}`);
        }
        
        const validHandleType = Object.values(HandleType);
        if (this.handle_type && !validHandleType.some((v) => this.handle_type!.split(',').includes(v))) {
            throw new ModelException(`handle_type must be ${validHandleType.join(', ')}`);
        }

        if (this.length)
        {
            const lengthMErrorMsg = "Length must be a number or a range of numbers (ex: 1-28) and can't exceed 28";
            let minLength = this.length;
            let maxLength = this.length;
            if (this.length?.includes('-')) {
                minLength = this.length.split('-')[0];
                maxLength = this.length.split('-')[1];
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
        }

        const validModifiers = ['negative', 'decimal'];
        if (this.numeric_modifiers && !validModifiers.some((v) => this.numeric_modifiers!.split(',').includes(v))) {
            throw new ModelException(`numeric_modifiers must be ${validModifiers.join(', ')}`);
        }
        if (this.search && this.search!.length < 3) {
            throw new ModelException('search must be at least 3 characters');
        }
        if (this.handles && !Array.isArray(this.handles)) {
            throw new ModelException(`expected array and received ${typeof this.handles}`);
        }


    }
}
