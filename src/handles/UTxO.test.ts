import { UTxO, UTxOWithTxInfo } from './UTxO';

describe('UTxO', () => {
    const source: UTxOWithTxInfo = {
        id: 'tx123#0',
        tx_id: 'tx123',
        index: 0,
        blockHash: 'block-hash',
        blockNum: 42,
        slot: 123456,
        address: 'addr_test1...',
        lovelace: 2500000,
        datum: 'datum-cbor',
        script: {
            type: 'PlutusV2',
            cbor: 'script-cbor'
        },
        handles: [['policy', ['74657374']]],
        mint: [['policy', ['74657374']]],
        burn: [['policy', ['6275726e']]],
        metadata: {721: {policy: {test: {name: '$test'}}}}
    };

    it('copies the chain output fields used by downstream marketplace records', () => {
        const utxo = new UTxO(source);

        expect(utxo).toEqual({
            id: source.id,
            blockHash: source.blockHash,
            blockNum: source.blockNum,
            tx_id: source.tx_id,
            index: source.index,
            slot: source.slot,
            address: source.address,
            lovelace: source.lovelace,
            datum: source.datum,
            script: source.script
        });
    });

    it('does not copy transaction index-only fields onto the runtime UTxO model', () => {
        const utxo = new UTxO(source) as UTxO & Partial<Pick<UTxOWithTxInfo, 'handles' | 'mint' | 'burn' | 'metadata'>>;

        expect(utxo.handles).toBeUndefined();
        expect(utxo.mint).toBeUndefined();
        expect(utxo.burn).toBeUndefined();
        expect(utxo.metadata).toBeUndefined();
    });
});
