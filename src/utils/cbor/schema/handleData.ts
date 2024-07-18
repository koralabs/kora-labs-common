export const handleDatumSchema = {
    constructor_0: {
        '[0]': {
            name: 'string',
            image: 'string',
            mediaType: 'string',
            og: 'bool',
            rarity: 'string',
            characters: 'string',
            numeric_modifiers: 'string',
            sub_rarity: 'string',
            sub_characters: 'string',
            sub_numeric_modifiers: 'string'
        },
        '[2]': {
            standard_image: 'string',
            bg_image: 'string',
            pfp_image: 'string',
            portal: 'string',
            designer: 'string',
            socials: 'string',
            vendor: 'string',
            default: 'bool',
            resolved_addresses: {
                ada: 'hex',
                '<string>': 'string'
            },
            migrate_sig_required: 'bool',
            trial: 'bool',
            nsfw: 'bool',
            svg_version: 'string',
            virtual: {
                expires_time: 'number',
                public_mint: 'bool'
            },
            original_address: 'hex'
        }
    }
};
