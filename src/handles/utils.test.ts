import { HandleType, Rarity } from './interfaces';
import { ScriptType } from './interfaces/ScriptDetails';
import { md5 } from 'js-md5';
import { decodeAddress } from '../utils';
import { RESPONSE_UNAVAILABLE_LEGENDARY } from './constants';
import { buildCharacters, buildDrep, buildMetadata, buildNumericModifiers, checkHandlePattern, getRarity } from './utils';

describe('validation tests', () => {
    it('should return true', () => {
        const result = checkHandlePattern('...');
        expect(result).toEqual({ message: 'Yay! This handle is available.', valid: true });
    });
    it('should return false', () => {
        const result = checkHandlePattern('***');
        expect(result).toEqual({
            message: 'Invalid handle. Only a-z, 0-9, dash (-), underscore (_), and period (.) are allowed.',
            valid: false
        });
    });
    it('should return true for SubHandle', () => {
        const result = checkHandlePattern('aaaaaaaaaaaaaaaaaaaaaaaaa@tt');
        expect(result).toEqual({ message: 'Yay! This handle is available.', valid: true });
    });
    it('should accept a 16-char root handle (>15, new 28-char cap)', () => {
        const result = checkHandlePattern('sixteencharsname');
        expect(result).toEqual({ message: 'Yay! This handle is available.', valid: true });
    });
    it('should accept a 28-char root handle (the new cap)', () => {
        const result = checkHandlePattern('twentyeightcharhandlename123');
        expect(result.valid).toBe(true);
    });
    it('should reject a 29-char root handle (over the 28 cap)', () => {
        const result = checkHandlePattern('twentyninecharhandlename12345');
        expect(result.valid).toBe(false);
    });
});

describe('buildMetadata', () => {
    it('should build metadata', () => {
        const input = {
            handleName: 'test',
            handleType: HandleType.HANDLE,
            cid: 'cid123',
            ogNumber: 1
        };
        const metadata = buildMetadata(input);
        expect(metadata).toEqual({
            characters: 'letters',
            handle_type: HandleType.HANDLE,
            image: `ipfs://${input.cid}`,
            length: 4,
            mediaType: 'image/jpeg',
            name: '$' + input.handleName,
            numeric_modifiers: '',
            og: input.ogNumber ? 1 : 0,
            og_number: input.ogNumber,
            rarity: 'common',
            version: 1
        });
    });

    it('should build metadata for negative decimal handle', () => {
        const input = {
            handleName: '-.02',
            handleType: HandleType.HANDLE,
            cid: 'cid123',
            ogNumber: 1
        };
        const metadata = buildMetadata(input);
        expect(metadata).toEqual({
            characters: 'numbers,special',
            handle_type: HandleType.HANDLE,
            image: `ipfs://${input.cid}`,
            length: 4,
            mediaType: 'image/jpeg',
            name: '$' + input.handleName,
            numeric_modifiers: 'negative,decimal',
            og: input.ogNumber ? 1 : 0,
            og_number: input.ogNumber,
            rarity: 'common',
            version: 1
        });
    });

    it('should build metadata for nft sub handle', () => {
        const input = {
            handleName: 'sub@handle',
            handleType: HandleType.NFT_SUBHANDLE,
            cid: 'cid111'
        };
        const metadata = buildMetadata(input);
        expect(metadata).toEqual({
            characters: 'letters',
            handle_type: HandleType.NFT_SUBHANDLE,
            image: `ipfs://${input.cid}`,
            length: 10,
            mediaType: 'image/jpeg',
            name: '$' + input.handleName,
            numeric_modifiers: '',
            og: 0,
            og_number: 0,
            rarity: Rarity.basic,
            version: 1,
            sub_characters: 'letters',
            sub_length: 3,
            sub_numeric_modifiers: '',
            sub_rarity: Rarity.rare
        });
    });

    it('should build metadata for nft sub handle with numbers', () => {
        const input = {
            handleName: '...@-123',
            handleType: HandleType.NFT_SUBHANDLE,
            cid: 'cid222'
        };
        const metadata = buildMetadata(input);
        expect(metadata).toEqual({
            characters: 'numbers,special',
            handle_type: HandleType.NFT_SUBHANDLE,
            image: `ipfs://${input.cid}`,
            length: 8,
            mediaType: 'image/jpeg',
            name: '$' + input.handleName,
            numeric_modifiers: '',
            og: 0,
            og_number: 0,
            rarity: Rarity.basic,
            version: 1,
            sub_characters: 'special',
            sub_length: 3,
            sub_numeric_modifiers: '',
            sub_rarity: Rarity.rare
        });
    });

    it('should build metadata for ultra-rare nft sub handle', () => {
        const input = {
            handleName: '..@ab',
            handleType: HandleType.NFT_SUBHANDLE,
            cid: 'cid222'
        };
        const metadata = buildMetadata(input);
        expect(metadata).toEqual({
            characters: 'letters,special',
            numeric_modifiers: '',
            handle_type: HandleType.NFT_SUBHANDLE,
            image: `ipfs://${input.cid}`,
            length: 5,
            mediaType: 'image/jpeg',
            name: '$' + input.handleName,
            og: 0,
            og_number: 0,
            rarity: Rarity.common,
            version: 1,
            sub_characters: 'special',
            sub_length: 2,
            sub_numeric_modifiers: '',
            sub_rarity: Rarity.ultra_rare
        });
    });
});

describe('ScriptType', () => {
    it('uses canonical slug values', () => {
        expect(ScriptType.PZ_CONTRACT).toBe('pers');
        expect(ScriptType.SUB_HANDLE_SETTINGS).toBe('subh');
        expect(ScriptType.MARKETPLACE_CONTRACT).toBe('mkpl');
        expect(ScriptType.DEMI_MINT).toBe('demimnt');
        expect(ScriptType.HAL_MINT_PROXY).toBe('halmntprx');
    });
});

describe('handle classification helpers', () => {
    it.each([
        ['a', Rarity.legendary],
        ['ab', Rarity.ultra_rare],
        ['abc', Rarity.rare],
        ['abcd', Rarity.common],
        ['abcdefg', Rarity.common],
        ['abcdefgh', Rarity.basic]
    ])('getRarity(%s) is %s', (name, rarity) => {
        expect(getRarity(name)).toBe(rarity);
    });

    it.each([
        ['abc', 'letters'],
        ['123', 'numbers'],
        ['a1_', 'letters,numbers,special'],
        ['a-b.c', 'letters,special']
    ])('buildCharacters(%s) is %s', (name, expected) => {
        expect(buildCharacters(name)).toBe(expected);
    });

    it.each([
        ['123', ''],
        ['-5', 'negative'],
        ['1.5', 'decimal'],
        ['-1.5', 'negative,decimal'],
        ['abc', '']
    ])('buildNumericModifiers(%s) is "%s"', (name, expected) => {
        expect(buildNumericModifiers(name)).toBe(expected);
    });

    it('rejects a single-character handle as legendary-unavailable', () => {
        expect(checkHandlePattern('a')).toEqual({ valid: false, message: RESPONSE_UNAVAILABLE_LEGENDARY });
    });

    it('marks og handles with their number and never og for subhandles', () => {
        const base = { handleType: HandleType.HANDLE, cid: 'c' };
        expect(buildMetadata({ ...base, handleName: 'abc', ogNumber: 7 })).toMatchObject({ og: 1, og_number: 7 });
        expect(buildMetadata({ ...base, handleName: 'abc' })).toMatchObject({ og: 0, og_number: 0 });
        expect(buildMetadata({ ...base, handleName: 'abc@root', ogNumber: 7 })).toMatchObject({ og: 0, og_number: 0, numeric_modifiers: '' });
    });
});

describe('buildDrep', () => {
    const address = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
    const credHex = decodeAddress(address)!.slice(2, 58);
    const hashFor = (typeByte: string) => md5(Buffer.from(credHex, 'hex')) + typeByte;

    it('returns undefined without an id hash, with a mismatching hash, or for an undecodable address', () => {
        expect(buildDrep(address)).toBeUndefined();
        expect(buildDrep(address, 'f'.repeat(34))).toBeUndefined();
        expect(buildDrep('not-an-address', hashFor('22'))).toBeUndefined();
    });

    it.each([
        ['22', 'drep', 'key'],
        ['23', 'drep', 'script'],
        ['12', 'cc_cold', 'key'],
        ['03', 'cc_hot', 'script']
    ])('type byte %s decodes to %s/%s with the matching credential', (typeByte, type, cred) => {
        const drep = buildDrep(address, hashFor(typeByte))!;
        expect(drep).toMatchObject({ type, cred, hex: credHex });
        expect(drep.cip_105.startsWith(type)).toBe(true);
        expect(drep.cip_129.startsWith(type)).toBe(true);
        expect(drep.cip_129).not.toBe(drep.cip_105);
    });
});
