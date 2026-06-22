// Server-only (Node) MPT module. Pulls @aiken-lang/merkle-patricia-forestry (native `level`/`blake2b`)
// so it is NOT re-exported from the package root — import it from the subpath:
//   import { computeMintingDataRoot } from '@koralabs/kora-labs-common/mpt';
// Mirrors the './aws' server-only convention; keeps the package root isomorphic/browser-safe.
import { Trie } from '@aiken-lang/merkle-patricia-forestry';

import * as labelSet from './labelSet';

export { labelSet };
// Re-export Trie so consumers get the MPF type/class from the same single source.
export { Trie };

const EMPTY_ROOT_HEX = Buffer.alloc(32).toString('hex');

/**
 * A minting-data MPT entry. A bare string is shorthand for a handle with no registry value
 * (value = ""). The object form carries the key's on-chain value — the sorted CIP-67 label set
 * (001-004) bytes. (The 3-free-virtual feature was removed, so keys no longer carry a free-name
 * value; the only non-empty value is the label set, once the in-band MintLabelAssets path ships.)
 */
export interface MintingDataEntry {
    name: string;
    /** Sorted CIP-67 label set (001-004) hex. Empty/absent => value "". The in-band MintLabelAssets
     * path is not on-chain yet, so callers pass "" today; flip to the real set when it ships. */
    labels?: string;
}

type MintingDataInput = ReadonlyArray<string | MintingDataEntry>;

/**
 * THE canonical minting-data MPT (a real {@link Trie}, for proof generation during mint/burn).
 * Consumers that only need the root hash should use {@link computeMintingDataRoot}; consumers that
 * generate proofs (the minting engine's verifyRootHash) keep the returned Trie.
 *
 * The value at each key is the sorted label-set bytes (CIP-67 001-004), byte-identical to what the
 * on-chain `demimntmpt` validator stores (`mpt.update` verifies the old bytes). A handle with no
 * labels => value "" (the `update_root` `mpt.insert(root, name, #"")` case), so passing bare strings
 * reproduces the empty-valued root exactly — which is every key today (labels not yet on-chain).
 */
export const buildMintingDataTrie = async (handles: MintingDataInput): Promise<Trie> => {
    const seen = new Set<string>();
    const entries: { key: string; value: string | Buffer }[] = [];
    for (const handle of handles) {
        const name = typeof handle === 'string' ? handle : handle.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const labels = typeof handle === 'string' ? '' : handle.labels ?? '';
        // The key's value is the sorted label-set bytes (CIP-67 001-004), or "" when it holds none.
        // The 3-free-virtual feature was removed, so no key carries a free-name value any more.
        // MPF treats string values as UTF-8; supply decoded bytes for a non-empty label set.
        entries.push({ key: name, value: labels ? Buffer.from(labels, 'hex') : '' });
    }
    return Trie.fromList(entries);
};

/**
 * THE canonical minting-data MPT root. Every Node service (api.handle.me, the minting engine,
 * handle.me/bff) and the on-chain mirror (@koralabs/handles-decentralized-minting) MUST compute
 * the root through this one function, so the off-chain root can never drift from what the
 * validator maintains. (It drifted before because api + engine each re-derived it independently —
 * and again when this function ignored the free-virtual registry value the contract writes.)
 *
 * Order-independent (MPT root is determined by the key/value set), so callers need not sort;
 * duplicate keys are de-duped to avoid a Trie insert throw.
 */
export const computeMintingDataRoot = async (handles: MintingDataInput): Promise<string> => {
    const trie = await buildMintingDataTrie(handles);
    return trie.hash?.toString('hex') ?? EMPTY_ROOT_HEX;
};
