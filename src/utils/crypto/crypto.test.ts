import { bech32FromHex, buildHolderInfo, buildPaymentAddressType, buildStakeKey, getPaymentKeyHash } from '.';
import { AddressType } from '../../types';

const addresses = ['addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x', 'addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh', 'addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve', 'addr1x8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gt7r0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shskhj42g', 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k', 'addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu', 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8', 'addr1w8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcyjy7wx', 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5'];

describe('Serialization Test', () => {
    describe('getHolderAddressFromAddress', () => {
        it('should build stake keys', async () => {
            const array = addresses.map((addr) => buildStakeKey(addr));
            expect(array).toEqual(['stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw', 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5', 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5', null, null, null, null, null, null]);
        });

        it('should build a proper stake key for testnet', () => {
            const stakeKey = buildStakeKey('addr_test1qpc34q6xuwjqn4l0f283xgct0e6z2x4l4sxufpmap2an9eptvx3phm9udvcenw457r6742a0e3gwhplv7hxggdr96cjstkwxff');
            expect(stakeKey).toEqual('stake_test1uq4krgsmaj7xkvveh260pa024whuc58tslk0tnyyx3javfg36sly7');
        });
    });

    describe('getAddressType', () => {
        it('should get the correct address types for addresses', async () => {
            const array = addresses.map((addr) => buildPaymentAddressType(addr));
            expect(array).toEqual(['wallet', 'script', 'wallet', 'script', 'wallet', 'script', 'enterprise', 'script', 'reward', 'reward']);
        });

        it('should return other for Byron era address', async () => {
            const type = buildPaymentAddressType('37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na');
            expect(type).toEqual(AddressType.Other);
        });
    });

    describe('bech32FromHex', () => {
        it('should convert hex to bech32 address and stake key', async () => {
            const hex = '007ad324c4fb08709dd997f6b2ba7980d5007103a2aa3f7a7eb8b44bc6f1a8e379127b811583070faf74db00d880d45027fe6171b1b69bd9ca';
            const result = bech32FromHex(hex, true);
            expect(result).toEqual('addr_test1qpadxfxylvy8p8wejlmt9wnesr2squgr524r77n7hz6yh3h34r3hjynmsy2cxpc04a6dkqxcsr29qfl7v9cmrd5mm89qqh563f');
        });

        it('should convert hex to bech32', async () => {
            const hex = '007ad324c4fb08709dd997f6b2ba7980d5007103a2aa3f7a7eb8b44bc6f1a8e379127b811583070faf74db00d880d45027fe6171b1b69bd9ca';
            const result = bech32FromHex(hex, true);
            expect(result).toEqual('addr_test1qpadxfxylvy8p8wejlmt9wnesr2squgr524r77n7hz6yh3h34r3hjynmsy2cxpc04a6dkqxcsr29qfl7v9cmrd5mm89qqh563f');
        });

        it('should convert a non-stake key address', () => {
            const hex = '60799fc22ad4b786ef2e3f7c7d3eb85aaa6af7fcedf6528e5334bcd955';
            const result = bech32FromHex(hex, true);
            expect(result).toEqual('addr_test1vpuels326jmcdmew8a78604ct24x4aluahm99rjnxj7dj4gzw0s3x');
        });
    });

    describe('getPaymentKeyHash', () => {
        it('should get payment keyhash from Shelley addresses', async () => {
            expect(await (getPaymentKeyHash('addr_test1vpe49pprjs8lxwjtf8h09dklg8henc2dw3xjp9dgcxyjyusf6672w')))
                .toEqual('73528423940ff33a4b49eef2b6df41ef99e14d744d2095a8c1892272');
            expect(await (getPaymentKeyHash('addr_test1xznnmfk43w5cag3m7e9nnfe0wcsg5lx8afv4u9utjk3zxvy4cujapvhtklq9nl02hvl4z6p24lgtwgplelma7w78hxpqrxzwz4')))
                .toEqual('a73da6d58ba98ea23bf64b39a72f76208a7cc7ea595e178b95a22330');
            expect(await (getPaymentKeyHash('addr_test1qpnqgjfm0y2dnjsyauvteu8u034x7nxjjms8dxtjck8msplan4acsu62leue4yrwmt6spxr8qzpkmw2vw59mlgr2jagsslke7a')))
                .toEqual('6604493b7914d9ca04ef18bcf0fc7c6a6f4cd296e0769972c58fb807');
        });
        it('should get payment keyhash from Byron addresses', async () => {
            expect(await (getPaymentKeyHash('Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi')))
                .toEqual('ba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdd');
            expect(await (getPaymentKeyHash('37btjrVyb4KEB2STADSsj3MYSAdj52X5FrFWpw2r7Wmj2GDzXjFRsHWuZqrw7zSkwopv8Ci3VWeg6bisU9dgJxW5hb2MZYeduNKbQJrqz3zVBsu9nT')))
                .toEqual('9c708538a763ff27169987a489e35057ef3cd3778c05e96f7ba9450e');
        });
    });
});

describe('addresses tests', () => {
    describe('buildHolderInfo', () => {
        it('should get the address holder details', async () => {
            const stakeAddress = 'stake1u8g3pqp52xuel3csupu679l4ul54uh4c2pqemefqhwdwlksjhtqld';

            const address =
                'addr1q8p0ru6eqplg6ljpm23uydwt3dy8ezzfcqs76s7w64nyxkw3zzqrg5denlr3pcre4utltelfte0ts5zpnhjjpwu6aldqgv4fdd';
            const result = buildHolderInfo(address);
            expect(result).toEqual({
                address: stakeAddress,
                knownOwnerName: '',
                type: AddressType.Wallet
            });
        });

        it('should get the address holder details for jpg.store', async () => {
            const address = 'addr1w999n67e86jn6xal07pzxtrmqynspgx0fwmcmpua4wc6yzsxpljz3';
            const result = buildHolderInfo(address);
            expect(result).toEqual({
                address,
                knownOwnerName: 'jpg.store',
                type: AddressType.Script
            });
        });
    });
});

// TODO: Add test for verifySignature
// describe.skip('verifySignature tests', () => { 
//     it('should verify a signature', async () => {
//         const stakeAddress = 'stake_test1upe8ja86xc3s9l20k6q2fcjvma4kffnxjxwkfcl67pntp9sknxq9q';
//         const result = await verifySignature(stakeAddress, stakeAddress, {
//             'signature': '84582aa201276761646472657373581de0727974fa362302fd4fb680a4e24cdf6b64a666919d64e3faf066b096a166686173686564f4581de0727974fa362302fd4fb680a4e24cdf6b64a666919d64e3faf066b096584005c8a1d4e7f2aafa0ebc7c7c495ea54de78723cf40848698a528b73c41adf68328438b1ee1270257b7e915b9667a3c9d8402bad9da781a5ade12a6a30576a006',
//             'key': 'a4010103272006215820dc00b6d666549509afa7bf87f8df5add868f7751ed0530af2681b166c52f22b1'
//         });

//         expect(result).toBeTruthy();
//     });
// });
