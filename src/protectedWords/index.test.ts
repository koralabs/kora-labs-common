import { ProtectedWords } from '.';

describe('ProtectedWords tests', () => {
    // setup badword lists... Sorry Mom.
    const smallList = [
        'shittum', // good
        'ea.tmy5_hit', // bad
        's.h.i.t', // bad
        'punchbabies', //bad
        'i.love.life', // good
        'adastaker', // twitter
        'Xar', // private
        'blade', // SPO
        'AdAhQ', // SPO
        'lickmycooch', // bad
        'peckerhead', // bad
        'myahole', // bad
        'ipedophile', //bad
        'love2lickbabies', // bad
        'ilovebabies', // good
        'power2africa', // good
        'pussy1', // bad
        '1pussy', // bad
        'pussyx', // bad
        'xpussy', // bad
        'n1gg3r', // bad
        'pu55y', // bad
        'tinypreteenpp', // bad
        'tinypreteen', // questionable, but passes
        'goodtoeat', // good
        'organigram',
        'hail.hitler',
        'heil-hitler',
        'he1lh1tler',
        'heil0hitler',
        'kuklux-klan',
        'ku-kluxklan',
        'jewnazi',
        'heilnazi',
        'heilnazihitler',
        'compassionate',
        'rambutan',
        'passionate',
        'associate',
        'teentitans',
        'peanutbutter',
        'childhood',
        'deathstranding',
        'japan',
        'fuckyounigger'
    ];

    describe('checkAvailability tests', () => {
        it('Should do stuff', async () => {
            const results = await Promise.all(smallList.map((w) => ProtectedWords.checkAvailability(w)));
            expect(results.map((r) => {delete r.duration; return r})).toEqual([
                { "available": true, "handle": "shittum", "code": 200 },
                {
                  "available": false,
                  "handle": "ea.tmy5_hit",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "In string match found for 'shit'"
                },
                {
                  "available": false,
                  "handle": "s.h.i.t",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match (with stripped characters) on 'shit'"
                },
                {
                  "available": false,
                  "handle": "punchbabies",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Hatespeech match found for baby,punch"
                },
                { "available": true, "handle": "i.love.life", "code": 200 },
                { "available": true, "handle": "adastaker", "code": 200 },
                { "available": true, "handle": "xar", "code": 200 },
                { "available": true, "handle": "blade", "code": 200 },
                { "available": true, "handle": "adahq", "code": 200 },
                {
                  "available": false,
                  "handle": "lickmycooch",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for cooch,lick"
                },
                {
                  "available": false,
                  "handle": "peckerhead",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "In string match found for 'pecker'"
                },
                {
                  "available": false,
                  "handle": "myahole",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'ahole,my'"
                },
                {
                  "available": false,
                  "handle": "ipedophile",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "In string match found for 'pedophil'"
                },
                {
                  "available": false,
                  "handle": "love2lickbabies",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for baby,lick"
                },
                { "available": true, "handle": "ilovebabies", "code": 200 },
                { "available": true, "handle": "power2africa", "code": 200 },
                {
                  "available": false,
                  "handle": "pussy1",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number trim match on 'pussy'"
                },
                {
                  "available": false,
                  "handle": "1pussy",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number trim match on 'pussy'"
                },
                {
                  "available": false,
                  "handle": "pussyx",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number and 'x' trim match on 'pussy'"
                },
                {
                  "available": false,
                  "handle": "xpussy",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number and 'x' trim match on 'pussy'"
                },
                {
                  "available": false,
                  "handle": "n1gg3r",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number replacement match on 'nigger'"
                },
                {
                  "available": false,
                  "handle": "pu55y",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number replacement match on 'pussy'"
                },
                {
                  "available": false,
                  "handle": "tinypreteenpp",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for preteen,tiny,pp"
                },
                { "available": true, "handle": "tinypreteen", "code": 200 },
                { "available": true, "handle": "goodtoeat", "code": 200 },
                {
                  "available": false,
                  "handle": "organigram",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for organ,ram"
                },
                {
                  "available": false,
                  "handle": "hail.hitler",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'hitler'"
                },
                {
                  "available": false,
                  "handle": "heil-hitler",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'hitler'"
                },
                {
                  "available": false,
                  "handle": "he1lh1tler",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Number replacement match on 'heilhitler'"
                },
                {
                  "available": false,
                  "handle": "heil0hitler",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Split on numbers match for 'hitler'"
                },
                {
                  "available": false,
                  "handle": "kuklux-klan",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'klan'"
                },
                {
                  "available": false,
                  "handle": "ku-kluxklan",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'kluxklan'"
                },
                {
                  "available": false,
                  "handle": "jewnazi",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Hatespeech match found for jew,nazi"
                },
                {
                  "available": false,
                  "handle": "heilnazi",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Hatespeech match found for nazi,heil"
                },
                {
                  "available": false,
                  "handle": "heilnazihitler",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Hatespeech match found for hitler,heil"
                },
                {
                  "available": false,
                  "handle": "compassionate",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for ass,ate"
                },
                {
                  "available": false,
                  "handle": "rambutan",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for but,ram"
                },
                {
                  "available": false,
                  "handle": "passionate",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for ass,ate"
                },
                {
                  "available": false,
                  "handle": "associate",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for ass,ate"
                },
                {
                  "available": false,
                  "handle": "teentitans",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for teen,tit"
                },
                {
                  "available": false,
                  "handle": "peanutbutter",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for but,nut"
                },
                {
                  "available": false,
                  "handle": "childhood",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Suggestive language match found for child,hood"
                },
                {
                  "available": false,
                  "handle": "deathstranding",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Hatespeech match found for trans,death"
                },
                {
                  "available": false,
                  "handle": "japan",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "Protected word match on 'jap,an'"
                },
                {
                  "available": false,
                  "handle": "fuckyounigger",
                  "type": "notallowed",
                  "code": 451,
                  "reason": "In string match found for 'fuck'"
                }
              ]);
        });
    });
});
