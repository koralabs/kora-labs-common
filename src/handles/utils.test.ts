import { HandleType, Rarity } from './interfaces';
import { buildMetadata, checkHandlePattern } from './utils';

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
