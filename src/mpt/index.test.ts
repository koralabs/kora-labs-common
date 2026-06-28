import { computeMintingDataRoot, buildMintingDataTrie } from './index';

const EMPTY_ROOT = Buffer.alloc(32).toString('hex');

describe('mpt/index — canonical minting-data MPT root (the single source every service must use)', () => {
    it('empty input => the all-zero empty root', async () => {
        expect(await computeMintingDataRoot([])).toBe(EMPTY_ROOT);
    });

    it('root is order-independent (same key/value set => same root)', async () => {
        const a = await computeMintingDataRoot(['alice', 'bob', 'carol']);
        const b = await computeMintingDataRoot(['carol', 'alice', 'bob']);
        expect(a).toBe(b);
        expect(a).not.toBe(EMPTY_ROOT);
    });

    it('de-dupes duplicate keys (no Trie insert throw, root unchanged)', async () => {
        expect(await computeMintingDataRoot(['alice', 'alice'])).toBe(await computeMintingDataRoot(['alice']));
    });

    it('a label set changes the root vs the bare empty-value handle', async () => {
        const bare = await computeMintingDataRoot([{ name: 'alice', labels: '' }]);
        const labeled = await computeMintingDataRoot([{ name: 'alice', labels: '000de140' }]);
        expect(labeled).not.toBe(bare);
    });

    it('a bare string and an empty-labels object encode identically (same key, value "")', async () => {
        expect(await computeMintingDataRoot(['alice'])).toBe(await computeMintingDataRoot([{ name: 'alice', labels: '' }]));
    });

    it('computeMintingDataRoot === buildMintingDataTrie().hash', async () => {
        const trie = await buildMintingDataTrie(['alice', 'bob']);
        expect(await computeMintingDataRoot(['alice', 'bob'])).toBe(trie.hash.toString('hex'));
    });
});
