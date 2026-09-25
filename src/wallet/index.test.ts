import fs from 'fs';
import path from 'path';
import { bech32 } from 'bech32';
import bs58 from 'bs58';
import { Serialization } from '@cardano-sdk/core';
import { addressHexToBech32, lovelaceFromBalance, parseUtxo } from './index';

// Real CIP-30 UTxO CBOR; `expected` is Blockfrost's (db-sync) view of the same output — an oracle
// independent of the parser under test. See the fixture's _provenance.
interface Fixture {
    label: string;
    cbor: string;
    expected: { id: string; lovelace: string; assets: Record<string, string>; inlineDatum: boolean; referenceScript: boolean };
}
const { utxos: FIXTURES } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cip30Utxos.fixture.json'), 'utf8')) as { utxos: Fixture[] };
const byLabel = (prefix: string) => FIXTURES.find((f) => f.label.startsWith(prefix)) as Fixture;

const assetsAsUnits = (assets: { policyId: string; hex: string; count: number }[]) =>
    Object.fromEntries(assets.map((a) => [`${a.policyId}${a.hex}`, String(a.count)]));

describe('parseUtxo (real CIP-30 UTxO CBOR)', () => {
    it.each(FIXTURES.map((f) => [f.label, f] as const))('%s: id, lovelace and every asset match the chain', (_label, fixture) => {
        const parsed = parseUtxo(fixture.cbor);
        expect(parsed).not.toBeNull();
        expect(parsed!.id).toBe(fixture.expected.id);
        expect(parsed!.lovelace).toBe(BigInt(fixture.expected.lovelace));
        expect(assetsAsUnits(parsed!.assets)).toEqual(fixture.expected.assets);
        // The wallet's bytes are kept verbatim so a backend receives exactly what the wallet returned.
        expect(parsed!.cbor).toBe(fixture.cbor);
    });

    it('covers every output shape a CIP-30 wallet returns', () => {
        const shapes = FIXTURES.map((f) => ({
            mapForm: /^a[0-9]/.test(f.cbor.slice(74)),
            assets: Object.keys(f.expected.assets).length,
            policies: new Set(Object.keys(f.expected.assets).map((unit) => unit.slice(0, 56))).size,
            inlineDatum: f.expected.inlineDatum,
            referenceScript: f.expected.referenceScript
        }));
        expect(shapes.some((s) => !s.mapForm && s.assets === 0)).toBe(true); // legacy array-form, pure ADA
        expect(shapes.some((s) => !s.mapForm && s.policies > 1)).toBe(true); // legacy array-form, multi-policy
        expect(shapes.some((s) => s.mapForm && s.inlineDatum)).toBe(true); // Babbage map-form, inline datum
        expect(shapes.some((s) => s.mapForm && s.referenceScript)).toBe(true); // Babbage map-form, reference script
    });

    it('splits the 263-asset multi-policy UTxO into policy id + asset name hex exactly', () => {
        const parsed = parseUtxo(byLabel('preprod E2E wallet mega UTxO').cbor)!;
        expect(parsed.assets).toHaveLength(263);
        expect(new Set(parsed.assets.map((a) => a.policyId)).size).toBe(3);
        expect(parsed.assets.every((a) => a.policyId.length === 56)).toBe(true);
        // CIP-68 labelled names keep their label (callers decide how to display them).
        expect(parsed.assets.some((a) => a.hex.startsWith('000de140'))).toBe(true);
    });

    it('rejects input that is not a UTxO instead of inventing values', () => {
        const pureAda = byLabel('preview change output').cbor;
        expect(parseUtxo('')).toBeNull();
        expect(parseUtxo('   ')).toBeNull();
        expect(parseUtxo('80')).toBeNull(); // empty array
        expect(parseUtxo('not hex')).toBeNull();
        expect(parseUtxo(pureAda.slice(0, -2))).toBeNull(); // truncated
        expect(parseUtxo(pureAda.slice(74))).toBeNull(); // an output without its input
    });

    it('tolerates surrounding whitespace in a wallet response', () => {
        const fixture = byLabel('preview hal@handle_settings');
        expect(parseUtxo(`  ${fixture.cbor}\n`)?.id).toBe(fixture.expected.id);
    });
});

describe('lovelaceFromBalance (CIP-30 getBalance)', () => {
    it('reads a bare-coin balance', () => {
        // uint32 0x004c4b40 = 5,000,000
        expect(lovelaceFromBalance('1a004c4b40')).toBe(BigInt(5_000_000));
    });

    it('reads the coin of a [coin, multiasset] balance from a real wallet value', () => {
        const fixture = byLabel('preprod E2E wallet mega UTxO');
        const valueCbor = Serialization.TransactionUnspentOutput.fromCbor(fixture.cbor as never).output().amount().toCbor();
        expect(valueCbor.startsWith('82')).toBe(true);
        expect(lovelaceFromBalance(valueCbor)).toBe(BigInt(fixture.expected.lovelace));
    });

    it('throws on a malformed balance rather than reporting zero', () => {
        expect(() => lovelaceFromBalance('ff')).toThrow();
        expect(() => lovelaceFromBalance('')).toThrow();
    });
});

describe('addressHexToBech32 (CIP-30 address hex)', () => {
    // Independent oracle: decode with the bech32 library, not the SDK under test.
    const hexOf = (bech: string) => Buffer.from(bech32.fromWords(bech32.decode(bech, 1023).words)).toString('hex');
    const BASE = 'addr_test1qp4s6q7s4dx6yys0u8y58xrfvjuy0vghwu6cfhl8knqmgvvac3lvnx850vmrvmvwkcx9aqwv588rrfckzfcr254vc6dquks85k';
    const SCRIPT_BASE = 'addr_test1xp5gahy5jpx99p4vtnq2mfsmnjz84rfrqxyznqewp62mzy2tqcwlsq95pxz027092fzsjgpfzzaunne0qa9glmj38dfqafd0cf';

    it('round-trips real testnet base addresses (key and script payment credentials)', () => {
        expect(addressHexToBech32(hexOf(BASE))).toBe(BASE);
        expect(addressHexToBech32(hexOf(SCRIPT_BASE))).toBe(SCRIPT_BASE);
        expect(addressHexToBech32(`0x${hexOf(BASE)}`)).toBe(BASE);
    });

    it('uses the stake prefix for reward addresses and the mainnet prefix on mainnet', () => {
        const stakeKeyHash = hexOf(BASE).slice(58); // the base address's stake credential
        const testnetReward = `e0${stakeKeyHash}`;
        const mainnetReward = `e1${stakeKeyHash}`;
        expect(addressHexToBech32(testnetReward)).toBe(bech32.encode('stake_test', bech32.toWords(Buffer.from(testnetReward, 'hex')), 1023));
        expect(addressHexToBech32(mainnetReward)).toBe(bech32.encode('stake', bech32.toWords(Buffer.from(mainnetReward, 'hex')), 1023));
    });

    it('returns Byron addresses in base58', () => {
        const byron = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';
        expect(addressHexToBech32(Buffer.from(bs58.decode(byron)).toString('hex'))).toBe(byron);
    });

    it("returns '' for no address and throws for bytes that are not an address", () => {
        expect(addressHexToBech32('')).toBe('');
        expect(() => addressHexToBech32('ffff')).toThrow();
    });
});
