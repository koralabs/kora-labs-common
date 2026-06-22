// Server-only (Node) MPT module. Pulls @aiken-lang/merkle-patricia-forestry (native `level`/`blake2b`)
// so it is NOT re-exported from the package root — import it from the subpath:
//   import { computeMintingDataRoot } from '@koralabs/kora-labs-common/mpt';
// Mirrors the './aws' server-only convention; keeps the package root isomorphic/browser-safe.
import { Trie } from '@aiken-lang/merkle-patricia-forestry';

import * as labelSet from './labelSet';
import * as registryValue from './registryValue';

export { labelSet, registryValue };
// Re-export Trie so consumers get the MPF type/class from the same single source.
export { Trie };

const EMPTY_ROOT_HEX = Buffer.alloc(32).toString('hex');

/**
 * A minting-data MPT entry. A bare string is shorthand for a handle with no registry value
 * (value = ""). The object form carries the registry value the on-chain validator stores at the
 * key: `registryValue.encode(freeNames, labels)`.
 *   - `freeNames`: a ROOT's currently-claimed FREE private-virtual sub names (the free-virtual
 *     allowance). The DeMi free-virtual mint/burn path writes this into the root key's value, so it
 *     MUST be supplied or the off-chain root drifts from chain on every root holding a free virtual.
 *   - `labels`: the sorted CIP-67 label set (001-004). The in-band `MintLabelAssets` path is NOT
 *     yet deployed on-chain, so callers pass "" today; flip to the real label set when it ships.
 */
export interface MintingDataEntry {
    name: string;
    freeNames?: string[];
    labels?: string;
}

type MintingDataInput = ReadonlyArray<string | MintingDataEntry>;

/**
 * THE canonical minting-data MPT (a real {@link Trie}, for proof generation during mint/burn).
 * Consumers that only need the root hash should use {@link computeMintingDataRoot}; consumers that
 * generate proofs (the minting engine's verifyRootHash) keep the returned Trie.
 *
 * The value at each key is `registryValue.encode(freeNames, labels)` — byte-identical to what the
 * on-chain `demimntmpt` validator stores (`mpt.update` verifies the old bytes). A handle with no
 * free names and no labels encodes to "" (the legacy `update_root` `mpt.insert(root, name, #"")`
 * case), so passing bare strings reproduces the empty-valued root exactly.
 */
export const buildMintingDataTrie = async (handles: MintingDataInput): Promise<Trie> => {
    const seen = new Set<string>();
    const entries: { key: string; value: string | Buffer }[] = [];
    for (const handle of handles) {
        const name = typeof handle === 'string' ? handle : handle.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const freeNames = typeof handle === 'string' ? [] : handle.freeNames ?? [];
        const labels = typeof handle === 'string' ? '' : handle.labels ?? '';
        const encoded = registryValue.encode(freeNames, labels);
        // MPF treats string values as UTF-8; supply the decoded bytes for a non-empty registry
        // value, and "" (an empty value) for the common no-registry case.
        entries.push({ key: name, value: encoded ? Buffer.from(encoded, 'hex') : '' });
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
