import { describe, expect, it } from "bun:test";
import { CopyKind, kindOf } from "./copy-kind";

describe(kindOf, () => {
  it("calls an image an image, whatever its preview says", () => {
    expect(kindOf({ image: true, preview: "https://example.invalid" })).toBe(
      CopyKind.Image,
    );
  });

  it("calls a lone web address a link", () => {
    expect(
      kindOf({ image: false, preview: "  https://example.invalid/a?b=c\n" }),
    ).toBe(CopyKind.Link);
  });

  it("calls anything else text", () => {
    // Words around an address, or an address that isn't for the web.
    expect(
      kindOf({ image: false, preview: "see https://example.invalid" }),
    ).toBe(CopyKind.Text);
    expect(kindOf({ image: false, preview: "file:///etc/hosts" })).toBe(
      CopyKind.Text,
    );
  });
});
