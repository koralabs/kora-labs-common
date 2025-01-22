import { ModelException } from '../../errors';
import { ERROR_TEXT } from '../constants';
import { isNumeric } from '../../utils';
import { SortWithRandom } from '../../types'

export interface HandlePaginationInput {
    handlesPerPage?: string;
    sort?: SortWithRandom;
    page?: string;
    slotNumber?: string;
}

export class HandlePaginationModel {
    public page: number;
    public handlesPerPage: number;
    public sort: SortWithRandom;
    public slotNumber?: number | null;

    constructor(input?: HandlePaginationInput) {
        const { handlesPerPage, sort, page, slotNumber } = input ?? {};
        this.validateHandlePagination(handlesPerPage, sort, page, slotNumber);
        this.handlesPerPage = handlesPerPage ? parseInt(handlesPerPage) : 100;
        this.page = page ? parseInt(page) : 1;
        this.sort = sort ?? 'asc';
        this.slotNumber = slotNumber ? parseInt(slotNumber) : null;
    }

    private validateHandlePagination(handlesPerPage?: string, sort?: SortWithRandom, page?: string, slotNumber?: string): void {
        if (handlesPerPage && !isNumeric(handlesPerPage)) {
            throw new ModelException(ERROR_TEXT.HANDLE_LIMIT_INVALID_FORMAT);
        }
        if (handlesPerPage && parseInt(handlesPerPage) > 1000) {
            throw new ModelException(ERROR_TEXT.HANDLE_LIMIT_EXCEEDED);
        }
        if (page && !isNumeric(page)) {
            throw new ModelException(ERROR_TEXT.HANDLE_PAGE_INVALID);
        }
        if (sort && !['desc', 'asc', 'random'].includes(sort)) {
            throw new ModelException(ERROR_TEXT.HANDLE_SORT_INVALID);
        }
        if (slotNumber && !isNumeric(slotNumber)) {
            throw new ModelException(ERROR_TEXT.HANDLE_SLOT_NUMBER_INVALID);
        }
        if (page && slotNumber) {
            throw new ModelException(ERROR_TEXT.HANDLE_PAGE_AND_SLOT_NUMBER_INVALID);
        }
    }
}
