import { IS_PRODUCTION } from "../constants";
export const RESPONSE_AVAILABLE = 'Yay! This handle is available.';
export const RESPONSE_UNAVAILABLE_PAID = 'Sorry! This Handle is pending mint or already minted.';
export const RESPONSE_UNAVAILABLE_ACTIVE_SESSION = 'Pending purchase. Try a different variation.';
export const RESPONSE_UNAVAILABLE_RESERVED = 'This Handle has a private reservation. Private reservations will be contacted separately.';
export const RESPONSE_UNAVAILABLE_LEGENDARY = 'Legendary handles are not available to mint.';
export const RESPONSE_INVALID_HANDLE_FORMAT = 'Invalid handle. Only a-z, 0-9, dash (-), underscore (_), and period (.) are allowed.';
export const RESPONSE_NOT_ALLOWED = 'Sorry, that handle is not allowed.';
export const REGEX_SPLIT_ON_CHARS = /([0-9a-z]+)[@_.-]*/g;
export const REGEX_SPLIT_ON_NUMS = /([a-z]+)[0-9]*/g;
export const REGEX_HANDLE = new RegExp(/^[a-zA-Z0-9_.-]{1,15}$/);
export const REGEX_SUB_HANDLE = new RegExp(/(?:^[a-z0-9_.-]{1,15}$)|(?:^(?!.{29})[a-z0-9_.-]+@[a-z0-9_.-]{1,15}$)/g);
export const HANDLES_API_KEY = IS_PRODUCTION ? process.env.HANDLES_API_KEY ?? '' : ''
export const KORA_USER_AGENT = process.env.KORA_USER_AGENT ?? ''

export enum ERROR_TEXT {
    HANDLE_LIMIT_EXCEEDED = "'records_per_page' must be a number",
    HANDLE_LIMIT_INVALID_FORMAT = "'records_per_page' can't be more than 1000",
    HANDLE_SORT_INVALID = "'sort' must be 'desc' or 'asc'",
    HANDLE_PAGE_INVALID = "'page' must be a number",
    HANDLE_SLOT_NUMBER_INVALID = "'slot_number' must be a number",
    HANDLE_PAGE_AND_SLOT_NUMBER_INVALID = "'page' and 'slot_number' can't be used together"
}

export const HANDLES_PER_PAGE_MAX = 1000;
