import { describe, expect, it } from "bun:test";
import { CopyKind, kindOf } from "./copy-kind";

describe(kindOf, () => {
  it("calls a lone web address a link", () => {
    expect(kindOf("  https://example.invalid/a?b=c\n")).toBe(CopyKind.Link);
  });

  it("calls anything else text", () => {
    // Words around an address, or an address that isn't for the web.
    expect(kindOf("see https://example.invalid")).toBe(CopyKind.Text);
    expect(kindOf("file:///etc/hosts")).toBe(CopyKind.Text);
  });
});
