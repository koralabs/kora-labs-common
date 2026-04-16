import { createPrivateKey, createPublicKey, sign, verify } from 'crypto';

let _cms: typeof import('@emurgo/cardano-message-signing-nodejs') | undefined;

const getCms = async () => {
    if (!_cms) {
        _cms = await import('@emurgo/cardano-message-signing-nodejs');
    }
    return _cms;
};

/**
 * Produce a CIP-30 signData (CIP-8) signature.
 *
 * Builds COSE_Sign1 and COSE_Key structures that verifyCip30SignData can verify.
 *
 * @param privateKeyHex - raw Ed25519 private key (32 bytes hex)
 * @param publicKeyHex  - raw Ed25519 public key (32 bytes hex)
 * @param payloadHex    - hex of the payload to sign (e.g. UTF-8 bytes of requestId + handle)
 * @param addressHex    - hex of the signing address (included in COSE protected headers)
 * @returns { signature: string, key: string } — COSESign1 and COSEKey as CBOR hex
 */
export const signCip30Data = async (
    privateKeyHex: string,
    publicKeyHex: string,
    payloadHex: string,
    addressHex: string,
    /** Optional sign function for extended keys. Takes message hex, returns signature hex. */
    signFn?: (messageHex: string) => string
): Promise<{ signature: string; key: string }> => {
    const cms = await getCms();

    const payloadBytes = Buffer.from(payloadHex, 'hex');
    const addrBytes = Buffer.from(addressHex, 'hex');
    const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');

    // Build protected headers: algorithm = EdDSA, address = signing address
    const protectedHeaders = cms.HeaderMap.new();
    protectedHeaders.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
    protectedHeaders.set_header(cms.Label.new_text('address'), cms.CBORValue.new_bytes(addrBytes));

    const headers = cms.Headers.new(cms.ProtectedHeaderMap.new(protectedHeaders), cms.HeaderMap.new());
    const builder = cms.COSESign1Builder.new(headers, payloadBytes, false);

    // Sign the SigStructure with the Ed25519 private key.
    // Accepts 32-byte seed (Node.js crypto) or 64-byte extended key (Cardano BIP32).
    // For extended keys, a signFn callback must be provided since the standard
    // DER format doesn't support pre-clamped scalars.
    const sigStructureBytes = builder.make_data_to_sign().to_bytes();
    const privKeyRaw = Buffer.from(privateKeyHex, 'hex');
    let signatureBytes: Buffer;

    if (privKeyRaw.length <= 32) {
        // 32-byte seed: use Node.js crypto
        const privKeyDer = Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            privKeyRaw
        ]);
        const keyObject = createPrivateKey({ key: privKeyDer, format: 'der', type: 'pkcs8' });
        signatureBytes = sign(null, Buffer.from(sigStructureBytes), keyObject);
    } else if (signFn) {
        // Extended key with custom sign function (e.g. @cardano-sdk/crypto Ed25519PrivateKey.sign)
        signatureBytes = Buffer.from(signFn(Buffer.from(sigStructureBytes).toString('hex')), 'hex');
    } else {
        throw new Error('64-byte extended key requires a signFn parameter');
    }

    const coseSign1 = builder.build(signatureBytes);

    // Build COSE_Key with the public key
    const coseKey = cms.COSEKey.new(cms.Label.from_key_type(cms.KeyType.OKP));
    coseKey.set_algorithm_id(cms.Label.from_algorithm_id(cms.AlgorithmId.EdDSA));
    coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-1)), cms.CBORValue.from_label(cms.Label.from_curve_type(cms.CurveType.Ed25519)));
    coseKey.set_header(cms.Label.new_int(cms.Int.new_i32(-2)), cms.CBORValue.new_bytes(pubKeyBytes));

    return {
        signature: Buffer.from(coseSign1.to_bytes()).toString('hex'),
        key: Buffer.from(coseKey.to_bytes()).toString('hex')
    };
};

/**
 * Verify a CIP-30 signData (CIP-8) signature.
 *
 * Parses the COSE structures produced by the wallet, reconstructs the
 * SigStructure using the library (not manual CBOR), and verifies the
 * Ed25519 signature with Node.js crypto.
 *
 * @param signatureCborHex - COSESign1 CBOR hex from wallet signData response
 * @param publicKeyCborHex - COSEKey CBOR hex from wallet signData response
 * @param expectedPayloadHex - hex of the expected signed payload (e.g. requestId + handle as UTF-8 bytes)
 * @param expectedAddressHex - hex of the expected signing address (must match the address in the COSE protected headers)
 * @returns true if the signature is valid
 */
export const verifyCip30SignData = async (
    signatureCborHex: string,
    publicKeyCborHex: string,
    expectedPayloadHex: string,
    expectedAddressHex: string
): Promise<boolean> => {
    const cms = await getCms();

    // Parse COSESign1 and COSEKey from wallet output
    const coseSign1 = cms.COSESign1.from_bytes(Buffer.from(signatureCborHex, 'hex'));
    const coseKey = cms.COSEKey.from_bytes(Buffer.from(publicKeyCborHex, 'hex'));

    // Extract the address from the protected headers and verify it matches
    const protectedHeaders = coseSign1.headers().protected().deserialized_headers();
    const addressLabel = cms.Label.new_text('address');
    const addressValue = protectedHeaders.header(addressLabel);
    if (addressValue) {
        const addressBytes = Buffer.from(addressValue.as_bytes() ?? new Uint8Array()).toString('hex');
        if (addressBytes !== expectedAddressHex) {
            return false;
        }
    }

    // Verify the payload matches what we expect
    const signedPayload = coseSign1.payload();
    if (signedPayload) {
        const payloadHex = Buffer.from(signedPayload).toString('hex');
        if (payloadHex !== expectedPayloadHex) {
            return false;
        }
    }

    // Reconstruct the SigStructure (what was actually signed) using the library
    const sigStructure = coseSign1.signed_data();
    const sigStructureBytes = sigStructure.to_bytes();

    // Extract the raw Ed25519 signature
    const signatureBytes = coseSign1.signature();

    // Extract the Ed25519 public key from COSEKey (label -2 is the "x" coordinate / public key)
    const xLabel = cms.Label.new_int(cms.Int.new_i32(-2));
    const pubKeyValue = coseKey.header(xLabel);
    if (!pubKeyValue) {
        return false;
    }
    const pubKeyBytes = pubKeyValue.as_bytes();
    if (!pubKeyBytes || pubKeyBytes.length !== 32) {
        return false;
    }

    // Wrap the raw Ed25519 public key in DER SPKI format for Node.js crypto
    const pubKeyDer = Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(pubKeyBytes)
    ]);
    const keyObject = createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });

    return verify(null, Buffer.from(sigStructureBytes), keyObject, Buffer.from(signatureBytes));
};
