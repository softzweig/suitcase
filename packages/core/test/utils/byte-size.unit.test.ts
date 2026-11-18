import { describe, expect, test } from "vitest";
import { ByteSize, type ByteSizeString } from "../../src/utils/byte-size.js";

describe("ByteSize.parse", () => {
  test.for([
    { label: "a size", operand: ByteSize.parseString("1 KiB"), bytes: 1024 },
    { label: "a byte count", operand: 1024, bytes: 1024 },
    { label: "a string form", operand: "1 KiB", bytes: 1024 },
  ])("interprets ", ({ operand, bytes }) => {
    expect(ByteSize.parse(operand).toBytes()).toBe(bytes);
  });

  test("returns a size untouched", () => {
    const size = ByteSize.fromBytes(42);

    expect(ByteSize.parse(size)).toBe(size);
  });

  test.for<{ input: ByteSizeString | string; bytes: number }>([
    { input: "0 B", bytes: 0 },
    { input: "512 KB", bytes: 512_000 },
    { input: "10mb", bytes: 10_000_000 },
    { input: "2 GB", bytes: 2_000_000_000 },
    { input: "1 TB", bytes: 1_000_000_000_000 },
    { input: "1 KiB", bytes: 1024 },
    { input: "1.5 MiB", bytes: 1_572_864 },
    { input: "2GiB", bytes: 2_147_483_648 },
    { input: "1 tib", bytes: 1_099_511_627_776 },
    { input: "  42   kib  ", bytes: 43_008 },
  ])("parses $input", ({ input, bytes }) => {
    expect(ByteSize.parse(input).toBytes()).toBe(bytes);
  });

  test.for(["", "10", "MB", "10 XB", "1.2.3 MB", "ten MB", "-1 MB", "10 M1B"])(
    "rejects %s",
    (input) => {
      expect(() => ByteSize.parse(input)).toThrow();
    },
  );

  test("names the offending unit", () => {
    expect(() => ByteSize.parse("10 XB")).toThrow(/Unknown byte size unit: XB/);
  });
});

describe("ByteSize conversions", () => {
  test("converts between units", () => {
    const oneMiB = ByteSize.from(1, "MiB");

    expect(oneMiB.to("KiB")).toBe(1024);
    expect(oneMiB.to("MB")).toBe(1.048576);
    expect(oneMiB.toBytes()).toBe(1_048_576);
  });

  test("scales decimal and binary units differently", () => {
    expect(ByteSize.parse("1 KB").toBytes()).toBe(1000);
    expect(ByteSize.parse("1 KiB").toBytes()).toBe(1024);
  });

  test("round-trips through parse and to", () => {
    expect(ByteSize.parse("1.5 MiB").to("MiB")).toBe(1.5);
  });

  test("round-trips what format prints", () => {
    for (const bytes of [0, 999, 1000, 1_500_000, 2_500_000_000_000]) {
      expect(ByteSize.parse(ByteSize.fromBytes(bytes).format()).toBytes()).toBe(bytes);
    }
  });

  test.for([
    { method: "ceil", from: 1.2, to: 2 },
    { method: "floor", from: 1.8, to: 1 },
    { method: "round", from: 1.6, to: 2 },
  ] as const)("rounds with $method", ({ method, from, to }) => {
    expect(ByteSize.fromBytes(from)[method]().toBytes()).toBe(to);
  });
});

describe("ByteSize comparisons", () => {
  const decimal = ByteSize.parse("1 KB");
  const binary = ByteSize.parse("1 KiB");

  test("compares by byte count, not by unit", () => {
    expect(decimal.lt(binary)).toBe(true);
    expect(decimal.lte(binary)).toBe(true);
    expect(binary.gt(decimal)).toBe(true);
    expect(binary.gte(decimal)).toBe(true);
  });

  test("equates equal sizes across units", () => {
    expect(ByteSize.parse("1024 KB").eq(ByteSize.parse("1.024 MB"))).toBe(true);
    expect(binary.eq(decimal)).toBe(false);
  });

  test("knows what zero is", () => {
    expect(ByteSize.fromBytes(0).isZero()).toBe(true);
    expect(ByteSize.fromBytes(1).isZero()).toBe(false);
  });
});

describe("ByteSize arithmetic", () => {
  test("adds every operand form", () => {
    const base = ByteSize.parse("1 KB");

    expect(base.add(24).toBytes()).toBe(1024);
    expect(base.add("24 B").toBytes()).toBe(1024);
    expect(base.add(ByteSize.parse("1 KiB")).toBytes()).toBe(2024);
  });

  test("subtracts every operand form", () => {
    const base = ByteSize.parse("1 KiB");

    expect(base.subtract(24).toBytes()).toBe(1000);
    expect(base.subtract("24 B").toBytes()).toBe(1000);
    expect(base.subtract(ByteSize.parse("1 KB")).toBytes()).toBe(24);
  });

  test("refuses to go below zero", () => {
    expect(() => ByteSize.parse("1 KB").subtract("1 KiB")).toThrow(RangeError);
    expect(ByteSize.parse("1 KB").subtract(1000).toBytes()).toBe(0);
  });

  test("multiplies by every operand form", () => {
    const base = ByteSize.parse("1 KB");

    expect(base.multiply(2).toBytes()).toBe(2000);
    expect(base.multiply(1.5).toBytes()).toBe(1500);
    expect(base.multiply("2 B").toBytes()).toBe(2000);
    expect(base.multiply(ByteSize.fromBytes(2)).toBytes()).toBe(2000);
  });

  test("leaves the original untouched", () => {
    const base = ByteSize.parse("1 KB");

    base.add("1 MB");
    base.multiply(10);

    expect(base.toBytes()).toBe(1000);
  });
});

describe("ByteSize.format", () => {
  test("toString is format with the default cap", () => {
    const size = ByteSize.fromBytes(1_500_000);

    expect(String(size)).toBe(size.format());
    expect(`${size}`).toBe("1.5 MB");
  });

  test.for([
    { bytes: 0, expected: "0 B" },
    { bytes: 999, expected: "999 B" },
    { bytes: 1000, expected: "1 KB" },
    { bytes: 1024, expected: "1.02 KB" },
    { bytes: 1_000_000, expected: "1 MB" },
    { bytes: 1_500_000, expected: "1.5 MB" },
    { bytes: 1_000_000_000, expected: "1 GB" },
    { bytes: 1_000_000_000_000, expected: "1 TB" },
    { bytes: 2_500_000_000_000, expected: "2.5 TB" },
  ])("formats $bytes bytes as $expected", ({ bytes, expected }) => {
    expect(ByteSize.fromBytes(bytes).format()).toBe(expected);
  });

  test.for([
    { maxFractionDigits: 0, expected: "2 KB" },
    { maxFractionDigits: 1, expected: "1.5 KB" },
    { maxFractionDigits: 3, expected: "1.536 KB" },
  ])("caps the fraction at $maxFractionDigits", ({ maxFractionDigits, expected }) => {
    expect(ByteSize.fromBytes(1536).format(maxFractionDigits)).toBe(expected);
  });
});
