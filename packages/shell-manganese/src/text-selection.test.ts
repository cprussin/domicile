import { describe, expect, it } from "bun:test";

import { loadEmittedStylesheet } from "./emitted-stylesheet";

loadEmittedStylesheet(document);

describe("text selection", () => {
  it("is off across the shell", () => {
    // The shell is a desktop, not a document: a drag across the bar or a
    // title that paints a selection is a drag that went wrong.
    expect(
      globalThis.getComputedStyle(document.documentElement).userSelect,
    ).toBe("none");
  });

  it("stays on in a field, which is text somebody typed", () => {
    const field = document.createElement("input");
    document.body.append(field);

    expect(globalThis.getComputedStyle(field).userSelect).toBe("text");
  });
});
