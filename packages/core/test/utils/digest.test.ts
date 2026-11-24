import { utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, test } from "vitest";
import { digestBytes } from "../../src/utils/digest.js";

// The package is runtime-agnostic, so the test spells its bytes without a platform global.
const bytes = (text: string) => utf8ToBytes(text);

describe("digestBytes", () => {
  // The published digests of "abc", so the helper is pinned to the real functions.
  test("hashes with sha256", () => {
    expect(digestBytes("sha256", bytes("abc"))).toEqual({
      hashAlgorithm: "sha256",
      hashHex: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  test("hashes with sha512", () => {
    expect(digestBytes("sha512", bytes("abc"))).toMatchObject({
      hashAlgorithm: "sha512",
      hashHex:
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    });
  });

  test("takes an ArrayBuffer as it is", () => {
    expect(digestBytes("sha256", bytes("abc").buffer)).toEqual(digestBytes("sha256", bytes("abc")));
  });

  test("writes lowercase hex", () => {
    expect(digestBytes("sha256", bytes("abc")).hashHex).toMatch(/^[a-f0-9]{64}$/);
  });
});
