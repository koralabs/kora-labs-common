import * as cbor from 'cbor';
import { boolean, isBooleanable } from 'boolean';

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

export enum KeyType {
    UTF8 = 'utf8',
    HEX = 'hex'
}

class JsonToDatumObject {
    json: any;
    numericKeys: boolean;
    constructor(json: any, numericKeys = false) {
        this.json = json;
        this.numericKeys = numericKeys;
        if (Array.isArray(this.json)) {
            for (let i = 0; i < this.json.length; i++) {
                this.json[i] = new JsonToDatumObject(this.json[i], numericKeys);
            }
        } else if (typeof this.json === 'object') {
            if (this.json !== null) {
                Object.keys(this.json).map((key) => {
                    this.json[key] = new JsonToDatumObject(this.json[key], numericKeys);
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

        return Buffer.from(key);
    };

    getHexOrString = (key: string) => {
        if (key.startsWith('0x')) {
            return Buffer.from(key.substring(2), 'hex');
        }

        if (key.startsWith('~0x')) {
            key = key.slice(1);
        }

        return Buffer.from(key);
    };

    encodeCBOR = (encoder: any) => {
        if (Array.isArray(this.json)) {
            return cbor.Encoder.encodeIndefinite(encoder, this.json);
        } else if (typeof this.json === 'object') {
            if (this.json !== null) {
                const fieldsMap = new Map();
                let tag = null;
                const keys = this.json instanceof Map ? this.json.keys() : Object.keys(this.json);
                for (let key of keys) {
                    if (key instanceof DupeKey) {
                        fieldsMap.set(key, this.json.get(key));
                    } else {
                        let split_key = parseInt(key.split('_').at(1) ?? '');
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
            const bufferedString = this.getHexOrString(this.json);

            return bufferedString.length > 64
                ? cbor.Encoder.encodeIndefinite(encoder, bufferedString, { chunkSize: 64 })
                : encoder.pushAny(bufferedString);
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
        return this.numericKeys && key !== null && key.length > 0 && !isNaN(key);
    };
}

export class DupeKey extends JsonToDatumObject {
    key: string;
    constructor(key: string) {
        super(key);
        this.key = key;
    }
}

export const encodeJsonToDatum = async (json: any, numericKeys = false) => {
    const obj = new JsonToDatumObject(json, numericKeys);
    const result = await cbor.encodeAsync(obj, { chunkSize: 64 });
    return result.toString('hex');
};

const parseSchema = (key: any, schema: any, defaultKeyType: KeyType, i: number) => {
    let schemaValue;

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
        if (schemaKey || defaultKeyType == KeyType.HEX) {
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
        if (schemaKey === '<hexstring>' || defaultKeyType == KeyType.HEX) {
            mapKey = hexKey;
        }
    }

    if (schemaKey) {
        schemaValue = schema[schemaKey];
    }

    return {
        mapKey,
        schemaValue
    };
};

const decodeObject = ({
    val,
    constr = null,
    schema = {},
    defaultKeyType = KeyType.UTF8,
    forJson = true
}: {
    val: any;
    constr?: number | null;
    schema?: any;
    defaultKeyType?: KeyType;
    forJson?: boolean;
}): any => {
    const isMap = val instanceof Map;
    if (isMap) {
        const obj = new Map();
        let dupeKeys = false;
        const keys = [...val.keys()];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            let value = val.get(key);

            const { mapKey, schemaValue } = parseSchema(key, schema, defaultKeyType, i);

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
                obj.set(newKey, decodeObject({ val: value, constr, schema: schemaValue, defaultKeyType, forJson }));
            } else {
                obj.set(mapKey, decodeObject({ val: value, constr, schema: schemaValue, defaultKeyType, forJson }));
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
            let value = val[key];

            const { mapKey, schemaValue } = parseSchema(key, schema, defaultKeyType, i);

            obj[mapKey] = decodeObject({ val: value, schema: schemaValue, defaultKeyType, forJson });
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

            arr.push(decodeObject({ val: arrayVal, schema: schemaValue, defaultKeyType, forJson }));
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
    defaultKeyType?: KeyType;
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
