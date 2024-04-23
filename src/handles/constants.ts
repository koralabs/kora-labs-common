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