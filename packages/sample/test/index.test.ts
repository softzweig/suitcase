import { describe, expect, it } from "vitest";

import { greet, PACKAGE_NAME } from "../src/index.js";

describe("greet", () => {
  it("greets a trimmed recipient", () => {
    expect(greet({ recipient: "  Suitcase  " })).toBe("Hello, Suitcase!");
  });

  it("accepts custom punctuation", () => {
    expect(greet({ recipient: "Ada", punctuation: "." })).toBe("Hello, Ada.");
  });

  it("rejects a blank recipient", () => {
    expect(() => greet({ recipient: "   " })).toThrow(TypeError);
  });
});

describe("PACKAGE_NAME", () => {
  it("matches the published package name", () => {
    expect(PACKAGE_NAME).toBe("@suitcase/sample");
  });
});
