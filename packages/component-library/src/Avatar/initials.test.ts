import { describe, expect, it } from "bun:test";

import { getInitials } from "./initials";

describe(getInitials, () => {
  it("returns a placeholder for blank names", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });

  it("returns a single uppercase initial for one-word names", () => {
    expect(getInitials("Connor")).toBe("C");
    expect(getInitials("ada")).toBe("A");
  });

  it("returns first and last initials for multi-word names", () => {
    expect(getInitials("Connor Prussin")).toBe("CP");
    expect(getInitials("ada lovelace")).toBe("AL");
  });

  it("uses first and last when there are middle names", () => {
    expect(getInitials("Connor Patrick Prussin")).toBe("CP");
    expect(getInitials("a b c d e")).toBe("AE");
  });

  it("collapses runs of whitespace", () => {
    expect(getInitials("  Ada    Lovelace  ")).toBe("AL");
  });

  it("handles single-character names", () => {
    expect(getInitials("A")).toBe("A");
    expect(getInitials("A B")).toBe("AB");
  });

  it("handles non-Latin characters", () => {
    expect(getInitials("一郎")).toBe("一");
    expect(getInitials("Émile Zola")).toBe("ÉZ");
  });

  it("handles emoji as the first character via code-point iteration", () => {
    expect(getInitials("🎉 party")).toBe("🎉P");
  });
});
