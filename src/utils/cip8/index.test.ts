import { verifyCip30SignData } from '.';

// ---- Fixture generation ----
// These fixtures were generated using @emurgo/cardano-message-signing-nodejs
// with a real Ed25519 key pair, signing the payload "test-request-id$alice"
// with a fake testnet address 0x00aa. The COSE structures match what a
// CIP-30 wallet would produce.
const generateFixture = async () => {
    const cms = await import('@emurgo/cardano-message-signing-nodejs');
    const crypto = await import('crypto');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubKeyRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);

    const payloadText = 'test-request-id$alice';
    const payloadBytes = Buffer.from(payloadText);
    const addressHex = '00aa';
    const addressBytes = Buffer.from(addressHex, 'hex');

    const protectedHeaders = cms.HeaderMap.new();
    protectedHeaders.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
    protectedHeaders.set_header(cms.Label.new_text('address'), cms.CBORValue.new_bytes(addressBytes));

    const headers = cms.Headers.new(cms.ProtectedHeaderMap.new(protectedHeaders), cms.HeaderMap.new());
    const builder = cms.COSESign1Builder.new(headers, payloadBytes, false);
    const sigStructureBytes = builder.make_data_to_sign().to_bytes();
    const signature = crypto.sign(null, Buffer.from(sigStructureBytes), privateKey);
    const coseSign1 = builder.build(signature);

    const coseKey = cms.COSEKey.new(cms.Label.from_key_type(cms.KeyType.OKP));
    coseKey.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
    coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-1)), cms.CBORValue.from_label(cms.Label.from_curve_type(cms.CurveType.Ed25519)));
    coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-2)), cms.CBORValue.new_bytes(pubKeyRaw));

    return {
        signatureCborHex: Buffer.from(coseSign1.to_bytes()).toString('hex'),
        publicKeyCborHex: Buffer.from(coseKey.to_bytes()).toString('hex'),
        payloadHex: payloadBytes.toString('hex'),
        addressHex
    };
};

describe('verifyCip30SignData', () => {
    it('should verify a valid CIP-30 signature', async () => {
        const fixture = await generateFixture();
        const result = await verifyCip30SignData(
            fixture.signatureCborHex,
            fixture.publicKeyCborHex,
            fixture.payloadHex,
            fixture.addressHex
        );
        expect(result).toBe(true);
    });

    it('should reject when payload does not match', async () => {
        const fixture = await generateFixture();
        const result = await verifyCip30SignData(
            fixture.signatureCborHex,
            fixture.publicKeyCborHex,
            Buffer.from('wrong-payload').toString('hex'),
            fixture.addressHex
        );
        expect(result).toBe(false);
    });

    it('should reject when address does not match', async () => {
        const fixture = await generateFixture();
        const result = await verifyCip30SignData(
            fixture.signatureCborHex,
            fixture.publicKeyCborHex,
            fixture.payloadHex,
            'deadbeef'
        );
        expect(result).toBe(false);
    });

    it('should reject a tampered signature', async () => {
        const fixture = await generateFixture();
        // Flip a byte in the signature CBOR (the signature field is near the end)
        const tampered = fixture.signatureCborHex.slice(0, -4) + 'ffff';
        const result = await verifyCip30SignData(
            tampered,
            fixture.publicKeyCborHex,
            fixture.payloadHex,
            fixture.addressHex
        );
        expect(result).toBe(false);
    });
});
