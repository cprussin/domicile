import { describe, expect, it } from "bun:test";

import { applyFont } from "./font";

const fontOf = (root: HTMLElement): string =>
  root.style.getPropertyValue("--desktop-font");

describe("applyFont", () => {
  it("names the face, quoted", () => {
    const root = document.createElement("html");

    applyFont("DejaVu Sans", root);

    expect(fontOf(root)).toBe('"DejaVu Sans"');
  });

  it("keeps a quote in the name inside the name", () => {
    const root = document.createElement("html");

    applyFont('Odd "Sans', root);

    expect(fontOf(root)).toBe('"Odd \\"Sans"');
  });

  // Blank is the default: Inter.
  it("clears the face for a blank name", () => {
    const root = document.createElement("html");
    applyFont("DejaVu Sans", root);

    applyFont("  ", root);

    expect(fontOf(root)).toBe("");
  });
});
