import { ICreatorDefaults } from '../../handles/interfaces';

// Schema-guided datum decoding for background/CIP-68 image details. Ported verbatim (behavior-
// preserving) from the handle.me BFF: it POSTs the datum CBOR to the Handles API `/datum` decoder
// with a field schema so specific TEXT fields are UTF-8-decoded. This is handle-property-correctness
// critical — the schema and the 0x-hex fallback below must not drift.

const defaultFetch = (url: string, init?: any) => (globalThis as any).fetch(url, init);

export interface DatumDecodeOptions {
    /** Extra request headers (e.g. api-key, User-Agent) required by the Handles API /datum endpoint. */
    headers?: Record<string, string>;
    /** Injectable fetch for tests; defaults to the runtime global fetch. */
    fetcher?: (url: string, init?: any) => Promise<{ text: () => Promise<string> }>;
}

export const decodeDatumViaApi = async <T>(
    apiHost: string,
    datum: string,
    schema?: Record<string, unknown>,
    options: DatumDecodeOptions = {}
): Promise<T> => {
    const fetcher = options.fetcher ?? defaultFetch;
    const response = await fetcher(`${apiHost}/datum?from=plutus_data_cbor&to=json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({ cbor: datum, schema })
    });
    const text = await response.text();
    if (!text.trim()) {
        // Empty response — return empty object instead of crashing.
        return {} as T;
    }
    return JSON.parse(text) as T;
};

// The api /datum decoder only UTF-8-decodes fields the schema can path to. When a background's
// CIP-68 `extra` is Constr-wrapped (Constr(0,[map]) at [2]), the schema's `[2]` fields don't match
// and these TEXT fields come back as `0x<hex>`. Colours/arrays are legitimately hex and left alone;
// only the known free-text fields are normalized back to UTF-8. A value already decoded (no 0x
// prefix) passes through unchanged.
const CREATOR_DEFAULT_TEXT_FIELDS = [
    'font',
    'qr_dot',
    'qr_inner_eye',
    'qr_outer_eye',
    'text_ribbon_gradient',
    'qr_image'
] as const;

export const decode0xHexToUtf8 = (v: unknown): unknown => {
    if (typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v) && v.length > 2) {
        try {
            return Buffer.from(v.slice(2), 'hex').toString('utf8');
        } catch {
            return v;
        }
    }
    return v;
};

export const normalizeCreatorDefaultTextFields = (creatorDefaults: Record<string, unknown>): void => {
    for (const field of CREATOR_DEFAULT_TEXT_FIELDS) {
        if (field in creatorDefaults) {
            creatorDefaults[field] = decode0xHexToUtf8(creatorDefaults[field]);
        }
    }
};

export interface ImageDatumDetails {
    image: string;
    creatorDefaults?: ICreatorDefaults;
    metadata?: Record<string, unknown>;
}

export const getImageDataFromDatum = async (
    apiHost: string,
    datum: string,
    options?: DatumDecodeOptions
): Promise<ImageDatumDetails> => {
    let decodedDatum: any;
    try {
        decodedDatum = await decodeDatumViaApi<any>(
            apiHost,
            datum,
            {
                constructor_0: {
                    '[0]': { name: 'string', image: 'string', category: 'string' },
                    '[2]': {
                        font: 'string',
                        text_ribbon_gradient: 'string',
                        force_creator_settings: 'bool',
                        qr_inner_eye: 'string',
                        qr_outer_eye: 'string',
                        qr_dot: 'string',
                        qr_image: 'string'
                    }
                }
            },
            options
        );
    } catch {
        return { image: '' };
    }

    const image = decodedDatum?.constructor_0?.[0]?.image;

    let data: ImageDatumDetails = { image };

    const creatorDefaults = decodedDatum?.constructor_0?.[2]?.constructor_0?.[0] ?? decodedDatum.constructor_0?.[2];
    if (creatorDefaults) {
        normalizeCreatorDefaultTextFields(creatorDefaults);
        data = { image, creatorDefaults, metadata: decodedDatum?.constructor_0?.[0] };
    }

    return data;
};
