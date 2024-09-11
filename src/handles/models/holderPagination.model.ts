import { ModelException } from '../../errors';
import { ERROR_TEXT } from '../constants';
import { isNumeric } from '../../utils';
import { Sort } from '../../types'

export interface HolderPaginationInput {
    recordsPerPage?: string;
    sort?: Sort;
    page?: string;
}

export class HolderPaginationModel {
    public page: number;
    public recordsPerPage: number;
    public sort: Sort;

    constructor(input?: HolderPaginationInput) {
        const { recordsPerPage, sort, page } = input ?? {};
        this.validateHolderPagination(recordsPerPage, sort, page);
        this.recordsPerPage = recordsPerPage ? parseInt(recordsPerPage) : 100;
        this.page = page ? parseInt(page) : 1;
        this.sort = sort ?? 'desc';
    }

    private validateHolderPagination(recordsPerPage?: string, sort?: Sort, page?: string): void {
        if (recordsPerPage && !isNumeric(recordsPerPage)) {
            throw new ModelException(ERROR_TEXT.HANDLE_LIMIT_INVALID_FORMAT);
        }
        if (recordsPerPage && parseInt(recordsPerPage) > 1000) {
            throw new ModelException(ERROR_TEXT.HANDLE_LIMIT_EXCEEDED);
        }
        if (page && !isNumeric(page)) {
            throw new ModelException(ERROR_TEXT.HANDLE_PAGE_INVALID);
        }
        if (sort && !['desc', 'asc'].includes(sort)) {
            throw new ModelException(ERROR_TEXT.HANDLE_SORT_INVALID);
        }
    }
}
