import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type AssetHash, AssetHashAlgorithm } from "../schemas/asset.js";

const HASHES = Object.freeze({
  [AssetHashAlgorithm.SHA256]: sha256,
  [AssetHashAlgorithm.SHA512]: sha512,
});

/**
 * The digest of some bytes, stated the way the contract spells an asset hash: which algorithm,
 * and lowercase hex. Pure JavaScript, so it runs in a browser, a worker, Node, Bun or Deno
 * without asking any of them for a crypto API.
 *
 * @example
 * ```ts
 * digestBytes("sha256", new Uint8Array([1, 2, 3]));
 * ```
 *
 * @human
 */
export function digestBytes(
  algorithm: AssetHashAlgorithm,
  bytes: Uint8Array | ArrayBuffer,
): AssetHash {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return { hashAlgorithm: algorithm, hashHex: bytesToHex(HASHES[algorithm](input)) };
}
