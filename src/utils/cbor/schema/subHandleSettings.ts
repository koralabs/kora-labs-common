const subHandleSettings = {
    '[0]': 'bool',
    '[1]': 'bool',
    '[3]': {
        bg_image: 'string',
        pfp_image: 'string',
        svg_version: 'string',
        qr_link: 'string',
        qr_inner_eye: 'string',
        qr_outer_eye: 'string',
        qr_dot: 'string',
        qr_image: 'string',
        font: 'string',
        text_ribbon_gradient: 'string'
    }
};

export const subHandleSettingsDatumSchema = {
    '[0]': subHandleSettings,
    '[1]': subHandleSettings,
    '[2]': 'number',
    '[3]': 'number',
    '[4]': 'number',
    '[5]': 'string',
    '[6]': 'bool',
    '[7]': 'hex'
};
