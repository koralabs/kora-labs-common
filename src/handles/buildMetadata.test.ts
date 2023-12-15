import { buildMetadata } from './buildMetadata';
import { HandleType, Rarity } from './interfaces';

describe('buildMetadata', () => {
    it('should build metadata', () => {
        const input = {
            handleName: 'test',
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

    it('should build metadata for nft sub handle', () => {
        const input = {
            handleName: 'sub@handle',
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
            rarity: 'common',
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
            numeric_modifiers: 'negative',
            og: 0,
            og_number: 0,
            rarity: 'common',
            version: 1,
            sub_characters: 'special',
            sub_length: 3,
            sub_numeric_modifiers: '',
            sub_rarity: Rarity.rare
        });
    });
});
