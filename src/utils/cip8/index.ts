import { createPublicKey, verify } from 'crypto';

let _cms: typeof import('@emurgo/cardano-message-signing-nodejs') | undefined;

const getCms = async () => {
    if (!_cms) {
        _cms = await import('@emurgo/cardano-message-signing-nodejs');
    }
    return _cms;
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
