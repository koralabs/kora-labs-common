// Server-only (Node) MPT module. Pulls @aiken-lang/merkle-patricia-forestry (native `level`/`blake2b`)
// so it is NOT re-exported from the package root — import it from the subpath:
//   import { computeMintingDataRoot } from '@koralabs/kora-labs-common/mpt';
// Mirrors the './aws' server-only convention; keeps the package root isomorphic/browser-safe.
import { Trie } from '@aiken-lang/merkle-patricia-forestry';

import * as labelSet from './labelSet';
import * as registryValue from './registryValue';

export { labelSet, registryValue };

const EMPTY_ROOT_HEX = Buffer.alloc(32).toString('hex');

/**
 * THE canonical minting-data MPT root. Every Node service (api.handle.me, the minting engine,
 * handle.me/bff) and the on-chain mirror (@koralabs/handles-decentralized-minting) MUST compute
 * the root through this one function, so the off-chain root can never drift from what the
 * validator maintains. (It drifted before because api + engine each re-derived it independently.)
 *
 * Value = "" (empty) per the legacy/DeMi mint validator's `update_root`:
 *   `mpt.insert(root, handle_name, #"", proof)`
 * Labels (001/002…) are NOT in the root until the in-band `MintLabelAssets` path is deployed;
 * until then the off-chain root MUST use empty values or it diverges from chain on every labeled
 * handle. When labels go in-band, change ONLY this function (accept a registry arg, set
 * value = registryValue.encode(freeNames, labels)) and every consumer moves in lockstep.
 *
 * Order-independent (MPT root is determined by the key/value set), so callers need not sort;
 * duplicate keys are de-duped to avoid a Trie insert throw.
 */
export const computeMintingDataRoot = async (handleNames: string[]): Promise<string> => {
    const uniqueKeys = Array.from(new Set(handleNames));
    const trie = await Trie.fromList(uniqueKeys.map((key) => ({ key, value: '' })));
    return trie.hash?.toString('hex') ?? EMPTY_ROOT_HEX;
};
