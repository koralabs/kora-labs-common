import { buildMintingDataTrie, computeMintingDataRoot, labelSet } from './';

describe('mpt labelSet', () => {
    it('keeps labels canonical and sorted', () => {
        const set = labelSet.insert('', '000643b0');
        const withLowerLabel = labelSet.insert(set, '000de140');
        const withEarlierLabel = labelSet.insert(withLowerLabel, '00000000');

        expect(withEarlierLabel).toEqual('00000000000643b0000de140');
        expect(labelSet.contains(withEarlierLabel, '000643B0')).toBe(true);
    });

    it('rejects duplicate, missing, and unsupported label deltas', () => {
        expect(() => labelSet.insert('000643b0', '000643b0')).toThrow('LABEL_ALREADY_PRESENT');
        expect(() => labelSet.remove('000643b0', '00000000')).toThrow('LABEL_ABSENT');
        expect(() => labelSet.apply('', '000643b0', BigInt(2))).toThrow('INVALID_AMOUNT');
    });

    it('applies mint and burn deltas to the encoded set', () => {
        const minted = labelSet.apply('', '000643b0', BigInt(1));
        expect(minted).toEqual('000643b0');
        expect(labelSet.apply(minted, '000643b0', BigInt(-1))).toEqual('');
    });

    it('decodes canonical label sets to raw trie bytes', () => {
        expect(labelSet.valueBuffer('000643b0')).toEqual(Buffer.from([0x00, 0x06, 0x43, 0xb0]));
    });
});

describe('minting data MPT', () => {
    it('returns the empty root for no handles', async () => {
        await expect(computeMintingDataRoot([])).resolves.toEqual(Buffer.alloc(32).toString('hex'));
    });

    it('computes the same root for the same key/value set regardless of input order', async () => {
        const root = await computeMintingDataRoot([
            { name: 'alice', labels: '000643b0' },
            { name: 'bob', labels: '000de140' },
            'charlie'
        ]);

        await expect(
            computeMintingDataRoot([
                'charlie',
                { name: 'bob', labels: '000de140' },
                { name: 'alice', labels: '000643b0' }
            ])
        ).resolves.toEqual(root);
    });

    it('deduplicates duplicate handle names before building the trie', async () => {
        const firstWinsRoot = await computeMintingDataRoot([{ name: 'alice', labels: '000643b0' }, { name: 'alice', labels: '000de140' }]);

        await expect(computeMintingDataRoot([{ name: 'alice', labels: '000643b0' }])).resolves.toEqual(firstWinsRoot);
    });

    it('stores non-empty label values as decoded bytes', async () => {
        const trie = await buildMintingDataTrie([{ name: 'alice', labels: '000643b0' }]);

        await expect(trie.get('alice')).resolves.toEqual(Buffer.from('000643b0', 'hex'));
    });
});
