import { boolean, isBooleanable } from 'boolean';
import * as cbor from 'cbor';

export { designerSchema } from './schema/designer';
export { handleDatumSchema } from './schema/handleData';
export { marketplaceDatumSchema } from './schema/marketplaceDatum';
export { portalSchema } from './schema/portal';
export { socialsSchema } from './schema/socials';

// The five ways to represent metadata/datum:
// Json (cardano-cli can take this with --tx-out-datum-json-value)
// TxMetadataJson ("Detailed Schema")
// TxMetadataCbor
// PlutusDataJson ("Schema Json")
// PlutusDataCbor

// Constructor vs Not
// Sort of similar to:
// const instance = new CustomObject(<json>)
// vs
// const obj = JSON.parse(<json>)

export enum DefaultTextFormat {
    UTF8 = 'utf8',
    HEX = 'hex'
}

export interface EncodeOptions {
    /** JavaScript doesn't support numeric object keys. CBOR does. 
     * This property converts keys that are numeric strings into numeric CBOR keys. Defaults to `false`.
     * @example
     * {"1": "abc", "2":"def"}
     * // will convert to the CBOR equivalent of
     * {1: "abc", 2: "def"}
    */
    numericKeys?: boolean, 
    /** Strings or Buffers larger than `chunkSize` are broken into an array of strings or Buffers. Defaults to `64`
     * @example
     * "01234567890123456789"
     * // chunkSize:10 will convert to the CBOR equivalent of
     * ['0123456789', '0123456789']
    */
    chunkSize?: number, 
    /** Whether to use CBOR "definite" or "indefinite" arrays. Defaults to `true`
     * @example
     * {indefiniteArrays: true} // will wrap arrays in the `9f[...]ff` CBOR Indefinite Major Type
     * {indefiniteArrays: false} // will preceed the array with the CBOR Major Type `8n[...]` (where `n` is the length of the array)
    */
    indefiniteArrays?: boolean,
    /**Whether strings should all be converted to CBOR byte strings or text strings. Defaults to `true`
     * @example
     * {defaultToText: false} // will preceed the bytes with the CBOR Major Type `4n[...]` (bytes)
     * {defaultToText: true} // will preceed the bytes with the CBOR Major Type `6n[...]` (text)
     * // where `n` is the length of the bytes
     */
    defaultToText?: boolean
}

class JsonToDatumObject {
    json: any;
    options: EncodeOptions
    constructor(json: any, options?: EncodeOptions) {
        this.json = json;
        this.options = {
            numericKeys: options?.numericKeys,
            chunkSize: options?.chunkSize ?? 64,
            indefiniteArrays: options?.indefiniteArrays ?? true,
            defaultToText: options?.defaultToText
        };
        if (Array.isArray(this.json)) {
            for (let i = 0; i < this.json.length; i++) {
                this.json[i] = new JsonToDatumObject(this.json[i], this.options );
            }
        } else if (typeof this.json === 'object') {
            if (this.json !== null) {
                Object.keys(this.json).map((key) => {
                    this.json[key] = new JsonToDatumObject(this.json[key], this.options);
                });
            }
        }
    }

    getFormattedKey = (key: string) => {
        if (key.startsWith('0x')) {
            return Buffer.from(key.substring(2), 'hex');
        }

        if (this.keyIsNumeric(key)) {
            return parseInt(key);
        }

        if (key.startsWith('~0x')) {
            key = key.slice(1);
        }

        return this.options.defaultToText ? key : Buffer.from(key);
    };

    getHexOrString = (str: string) => {
        if (str.startsWith('0x')) {
            return Buffer.from(str.substring(2), 'hex');
        }

        if (str.startsWith('~0x')) {
            str = str.slice(1);
        }

        return this.options.defaultToText ? str : Buffer.from(str);
    };

    encodeCBOR = (encoder: any) => {
        if (Array.isArray(this.json)) {
            return this.options.indefiniteArrays ? cbor.Encoder.encodeIndefinite(encoder, this.json) : encoder.pushAny(this.json);
        } else if (typeof this.json === 'object') {
            if (this.json !== null) {
                const fieldsMap = new Map();
                let tag = null;
                const keys = this.json instanceof Map ? this.json.keys() : Object.keys(this.json);
                for (const key of keys) {
                    if (key instanceof DupeKey) {
                        fieldsMap.set(key, this.json.get(key));
                    } else {
                        const split_key = parseInt(key.split('_').at(1) ?? '');
                        if (
                            key.startsWith('constructor_') &&
                            !isNaN(split_key) &&
                            [0, 1, 2, 3].includes(split_key as number)
                        ) {
                            tag = 121 + split_key;
                            return encoder.pushAny(new cbor.Tagged(tag, this.json[key]));
                        }

                        const bufferedKey = this.getFormattedKey(key);

                        fieldsMap.set(bufferedKey, this.json[key]);
                    }
                }
                return encoder.pushAny(fieldsMap);
            } else {
                return encoder.pushAny(Buffer.from('null'));
            }
        } else if (Number.isInteger(this.json)) {
            return encoder.pushAny(this.json);
        } else if (typeof this.json === 'string') {
            // check for hex and if so, decode it
            const str = this.getHexOrString(this.json);
            // @ts-expect-error TS is incorrect. The constructor always sets this.
            return str.length > this.options.chunkSize
                ? cbor.Encoder.encodeIndefinite(encoder, str, { chunkSize: this.options.chunkSize })
                : encoder.pushAny(str);
        } else if (typeof this.json === 'boolean') {
            return encoder.pushAny(this.json ? 1 : 0);
        } else {
            // anything else: convert to simple type - String.
            // e.g. undefined, true, false, NaN, Infinity.
            // Some of these can't be represented in JSON anyway.
            // Floating point numbers: note there can be loss of precision when
            // representing floats as decimal numbers
            return encoder.pushAny(Buffer.from('' + this.json));
        }
    };

    keyIsNumeric = (key: any) => {
        return this.options.numericKeys && key !== null && key.length > 0 && !isNaN(key);
    };
}

export class DupeKey extends JsonToDatumObject {
    key: string;
    constructor(key: string) {
        super(key);
        this.key = key;
    }
}

export const encodeJsonToDatum = async (json: any, options?: EncodeOptions) => {
    const obj = new JsonToDatumObject(json, options);
    const result = await cbor.encodeAsync(obj, { chunkSize: options?.chunkSize ?? 64 });
    return result.toString('hex');
};

const parseSchema = (key: any, schema: any, defaultKeyType: DefaultTextFormat, i: number) => {
    let schemaValueType;

    if (Number.isInteger(key)) {
        key = `${key}`;
    }
    let mapKey = Buffer.from(key).toString('utf8');
    const hexKey = `0x${Buffer.from(key).toString('hex')}`;

    // check schema to see if it matches

    // key name match
    let schemaKey = Object.keys(schema).find((k) => k === mapKey);
    if (!schemaKey) {
        schemaKey = Object.keys(schema).find((k) => k.replace('0x', '') === mapKey);
        if (schemaKey || defaultKeyType == DefaultTextFormat.HEX) {
            mapKey = hexKey;
        }
    }

    // index match
    if (!schemaKey) {
        schemaKey = Object.keys(schema).find((k) => k === `[${i}]`);
    }

    // dynamic match
    if (!schemaKey) {
        schemaKey = Object.keys(schema).find((k) => k.startsWith('<') && k.endsWith('>'));
        if (schemaKey === '<hexstring>' || defaultKeyType == DefaultTextFormat.HEX) {
            mapKey = hexKey;
        }
    }

    if (schemaKey) {
        schemaValueType = schema[schemaKey];
    }

    return {
        mapKey,
        schemaValueType
    };
};

interface StakeCredential {
    [stakeConstrKey: string]: string[];
}

interface Reference {
    [referenceConstrKey: string]: [StakeCredential];
}

interface Option {
    [optionConstrKey: string]: [Reference | undefined];
}

interface PaymentCredential {
    [paymentConstrKey: string]: string[];
}

interface AddressDatum {
    [networkConstrKey: string]: [PaymentCredential, Option | undefined];
}

const getAddressHexFromObject = (obj: AddressDatum) => {
    // beginning of address is split networkConstrKey on _ and use index[1]
    // address type is based on paymentConstrKey and stakeConstrKey
    let addressType;

    const networkConstrKey = Object.keys(obj)[0];
    const network = networkConstrKey.split('_')[1];
    const [paymentCredential, option] = obj[networkConstrKey];
    const paymentCredentialKey = Object.keys(paymentCredential)[0]; // 0 or 1
    const paymentHashType = paymentCredentialKey.split('_')[1];
    const paymentHash = Buffer.from(paymentCredential[paymentCredentialKey][0]).toString('hex');

    let stakeHashType;
    let stakeHash = '';
    if (option) {
        const [, [reference]] = Object.entries(option)[0];
        if (reference) {
            const referenceKey = Object.keys(reference)[0];
            const stakeCredentialKey = Object.keys(reference[referenceKey][0])[0];
            stakeHash = Buffer.from(reference[referenceKey][0][stakeCredentialKey][0]).toString('hex');
            stakeHashType = stakeCredentialKey.split('_')[1];            
        }
    }

    if (paymentHashType === '0' && stakeHashType === '0') {
        addressType = '0';
    }

    if (paymentHashType === '1' && stakeHashType === '0') {
        addressType = '1';
    }

    if (paymentHashType === '0' && stakeHashType === '1') {
        addressType = '2';
    }

    if (paymentHashType === '1' && stakeHashType === '1') {
        addressType = '3';
    }

    if (paymentHashType === '0' && !stakeHashType) {
        addressType = '6'
    }

    if (paymentHashType === '1' && !stakeHashType) {
        addressType = '7'
    }

    return `0x${addressType}${network}${paymentHash}${stakeHash}`;
};

const decodeObject = ({ val, constr = null, schema = {}, defaultKeyType = DefaultTextFormat.UTF8, forJson = true }: { val: any; constr?: number | null; schema?: any; defaultKeyType?: DefaultTextFormat; forJson?: boolean }): any => {
    const isMap = val instanceof Map;
    if (isMap) {
        const obj = new Map();
        let dupeKeys = false;
        const keys = [...val.keys()];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = val.get(key);

            const { mapKey, schemaValueType } = parseSchema(key, schema, defaultKeyType, i);

            if (obj.get(mapKey)) {
                dupeKeys = true;
                let newKey: string | DupeKey = `dupekey_str_${mapKey}_1`;

                const currentKeyIndex =
                    [...obj.keys()].filter(
                        (k: string | DupeKey) =>
                            (typeof k === 'string' && k.startsWith(`dupekey_str_${mapKey}`)) || k === mapKey
                    ).length - 1;
                let oldKey: string | DupeKey = `dupekey_str_${mapKey}_${currentKeyIndex}`;
                if (!forJson) {
                    newKey = new DupeKey(mapKey);
                    oldKey = new DupeKey(mapKey);
                }

                const prevValue = obj.get(mapKey);
                obj.delete(mapKey);
                obj.set(oldKey, prevValue);
                obj.set(newKey, decodeObject({ val: value, constr, schema: schemaValueType, defaultKeyType, forJson }));
            } else {
                obj.set(mapKey, decodeObject({ val: value, constr, schema: schemaValueType, defaultKeyType, forJson }));
            }
        }

        if (dupeKeys) {
            // convert keys that didnt get converted
            if (forJson) {
                [...obj.keys()].forEach((key) => {
                    if (!key.startsWith('dupekey')) {
                        const prevValue = obj.get(key);
                        obj.delete(key);
                        obj.set(`dupekey_str_${key}_0`, prevValue);
                    }
                });
            } else {
                // if key is a string, replace with dedupe class
                [...obj.keys()].forEach((key) => {
                    if (!(key instanceof DupeKey)) {
                        const prevValue = obj.get(key);
                        obj.delete(key);
                        obj.set(new DupeKey(key), prevValue);
                    }
                });
            }
        }

        const finalObj = dupeKeys && !forJson ? obj : Object.fromEntries(obj);
        if (constr != null) {
            return { [`constructor_${constr}`]: finalObj };
        } else {
            return finalObj;
        }
    } else if (typeof val === 'object' && val.constructor === Object) {
        const obj: any = {};
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = val[key];

            const { mapKey, schemaValueType } = parseSchema(key, schema, defaultKeyType, i);

            obj[mapKey] = decodeObject({ val: value, schema: schemaValueType, defaultKeyType, forJson });
        }
        if (constr != null) {
            return { [`constructor_${constr}`]: obj };
        } else {
            return obj;
        }
    } else if (Array.isArray(val)) {
        const arr = [];
        if (constr !== null && Object.keys(schema).some((k) => k === `constructor_${constr}`)) {
            schema = schema[`constructor_${constr}`];
        }

        for (let i = 0; i < val.length; i++) {
            const arrayVal = val[i];
            let schemaValue;
            let schemaKey;

            // index match
            if (!schemaKey) {
                schemaKey = Object.keys(schema).find((k) => k === `[${i}]`);
            }

            // dynamic match
            if (!schemaKey) {
                schemaKey = Object.keys(schema).find((k) => k === '[all]');
            }

            if (schemaKey) {
                schemaValue = schema[schemaKey];
            }

            if (schemaValue === 'Address') {
                const addressHex = getAddressHexFromObject(arrayVal);
                arr.push(addressHex);
            } else {
                arr.push(decodeObject({ val: arrayVal, schema: schemaValue, defaultKeyType, forJson }));
            }
        }
        if (constr != null) {
            return { [`constructor_${constr}`]: arr };
        } else {
            return arr;
        }
    } else if (Buffer.isBuffer(val)) {
        if (schema === 'string' || schema === 'bool') {
            const result = Buffer.from(val).toString('utf8');
            if (schema === 'bool' && isBooleanable(result)) {
                return boolean(result);
            }

            // Figure out if we want to add the ~ to the front of the hex string
            // if (result.startsWith('0x')) {
            //     return `~${result}`;
            // }

            return result;
        }

        return `0x${Buffer.from(val).toString('hex')}`;
    } else {
        if (schema === 'bool' && isBooleanable(val)) {
            return boolean(val);
        }

        return val;
    }
};

export const decodeCborToJson = async ({
    cborString,
    schema,
    defaultKeyType,
    forJson
}: {
    cborString: string;
    schema?: any;
    defaultKeyType?: DefaultTextFormat;
    forJson?: boolean;
}) => {
    const decoded = await cbor.decodeAll(Buffer.from(cborString, 'hex'), {
        tags: {
            121: (val: any) => ({ [`constructor_0`]: val }),
            122: (val: any) => ({ [`constructor_1`]: val }),
            123: (val: any) => ({ [`constructor_2`]: val }),
            124: (val: any) => ({ [`constructor_3`]: val })
        }
    });

    let [data] = decoded;
    data = decodeObject({ val: data, schema, defaultKeyType, forJson });

    return data;
};
