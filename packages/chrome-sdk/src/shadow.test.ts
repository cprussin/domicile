import { describe, expect, it } from "bun:test";

import { parseShadow, ShadowKind } from "./shadow";

/** The shadow itself, for the cases that expect one. */
const cast = (computed: string) => {
  const reading = parseShadow(computed);
  return reading.kind === ShadowKind.Cast ? reading.shadow : undefined;
};

const kindOf = (computed: string) => parseShadow(computed).kind;

describe("parseShadow", () => {
  it("reads the form a browser computes", () => {
    // `getComputedStyle` normalises to colour-first with every length in px,
    // whatever the author wrote.
    expect(cast("rgba(0, 0, 0, 0.5) 0px 4px 12px 0px")).toStrictEqual({
      blur: 12,
      color: [0, 0, 0, 0.5],
      dx: 0,
      dy: 4,
      spread: 0,
    });
  });

  it("reads one with no spread, which the shorthand may omit", () => {
    expect(cast("rgb(0, 0, 0) 2px 3px 4px")).toStrictEqual({
      blur: 4,
      color: [0, 0, 0, 1],
      dx: 2,
      dy: 3,
      spread: 0,
    });
  });

  it("reads a spread, which grows the shadow beyond the window", () => {
    expect(cast("rgb(1, 2, 3) 0px 0px 0px 6px")?.spread).toBe(6);
  });

  it("takes the first of several", () => {
    // CSS layers them front to back. Drawing one is a simplification; drawing
    // the *last* would be the wrong one, since the first is on top.
    const shadow = cast(
      "rgb(255, 0, 0) 1px 1px 1px, rgb(0, 255, 0) 9px 9px 9px",
    );
    expect(shadow?.dx).toBe(1);
    expect(shadow?.color).toStrictEqual([255, 0, 0, 1]);
  });

  it("has nothing to draw for `none`", () => {
    expect(kindOf("none")).toBe(ShadowKind.None);
    expect(kindOf("")).toBe(ShadowKind.None);
  });

  it("refuses an inset shadow rather than drawing it outside", () => {
    // An inset shadow is inside the box, over the client's own pixels. Drawing
    // it as an outer one would put a dark ring around a window that asked for
    // the opposite.
    expect(kindOf("rgb(0, 0, 0) 0px 0px 8px inset")).toBe(ShadowKind.Inset);
  });

  it("reads negative offsets, which point the shadow the other way", () => {
    const shadow = cast("rgb(0, 0, 0) -3px -5px 2px");
    expect([shadow?.dx, shadow?.dy]).toStrictEqual([-3, -5]);
  });

  it("refuses a negative blur rather than passing it to a shader", () => {
    expect(kindOf("rgb(0, 0, 0) 0px 0px -4px")).toBe(ShadowKind.Unreadable);
  });

  it("reads an oklab colour, which is what a token computes to", () => {
    // `color-mix(in oklab, ...)` is how every colour in this repo's design
    // system is written, and Chromium computes it to `oklab()`. An rgb-only
    // parser would silently drop the shadow on every themed window.
    const shadow = cast("oklab(0 0 0) 4px 8px 12px");
    expect(shadow?.color).toStrictEqual([0, 0, 0, 1]);
    expect([shadow?.dx, shadow?.dy, shadow?.blur]).toStrictEqual([4, 8, 12]);
  });

  it("reads oklab's white, which is the far end of the same conversion", () => {
    // Black alone would pass a conversion that returned zero for everything.
    const shadow = cast("oklab(1 0 0) 0px 0px 0px");
    expect(shadow?.color).toStrictEqual([255, 255, 255, 1]);
  });

  it("reads an oklab alpha, written after a slash", () => {
    const shadow = cast("oklab(0 0 0 / 0.25) 0px 0px 1px");
    expect(shadow?.color[3]).toBe(0.25);
  });

  it("reads oklch, the same space in polar form", () => {
    // Hue is irrelevant at zero chroma, so this is the same grey either way —
    // which is what makes it a check of the polar-to-rectangular step rather
    // than of the matrix again.
    const shadow = cast("oklch(1 0 180) 0px 0px 1px");
    expect(shadow?.color).toStrictEqual([255, 255, 255, 1]);
  });

  it("puts an oklab hue in the right channel", () => {
    // A conversion that dropped `a` and `b` would pass every grey above.
    const red = cast("oklab(0.628 0.225 0.126) 0px 0px 1px")?.color;
    expect(red?.[0]).toBeGreaterThan(240);
    expect(red?.[1]).toBeLessThan(64);
    expect(red?.[2]).toBeLessThan(64);
  });

  it("has nothing to draw for something it cannot read", () => {
    // A shadow it half-understood would be worse than none: the numbers go
    // straight into a shader, and a wrong one is a smear across the desktop.
    expect(kindOf("inherit")).toBe(ShadowKind.Unreadable);
    expect(kindOf("rgb(0, 0, 0)")).toBe(ShadowKind.Unreadable);
    expect(kindOf("color(display-p3 1 0 0) 0px 0px 4px")).toBe(
      ShadowKind.Unreadable,
    );
  });
});

describe("the three ways there is no shadow", () => {
  it("keeps them apart, because they are not the same news", () => {
    // Collapsing these into one absent value is what made an `inset` shadow
    // report itself as a syntax error: asked-for-nothing is normal, `inset` is
    // declined on purpose, and unreadable is a bug someone should hear about.
    expect(kindOf("none")).toBe(ShadowKind.None);
    expect(kindOf("")).toBe(ShadowKind.None);
    expect(kindOf("rgb(0, 0, 0) 0px 0px 8px inset")).toBe(ShadowKind.Inset);
    expect(kindOf("color(display-p3 1 0 0) 0px 0px 4px")).toBe(
      ShadowKind.Unreadable,
    );
    expect(kindOf("rgb(0, 0, 0) 0px 0px 4px")).toBe(ShadowKind.Cast);
  });

  it("clamps an alpha outside the range it can mean", () => {
    // Every other channel goes through the sRGB transfer function, which
    // clamps; alpha reaches the compositor as it stands.
    expect(cast("oklab(0.5 0 0 / 2) 0px 0px 1px")?.color[3]).toBe(1);
    expect(cast("oklab(0.5 0 0 / -1) 0px 0px 1px")?.color[3]).toBe(0);
  });

  it("does not guess at a percentage it will never be given", () => {
    // `getComputedStyle` resolves every component to a number, and a
    // percentage means 1 on lightness but 0.4 on `a` and `b` — so reading one
    // would be a 2.5x error in colour rather than a near miss.
    expect(kindOf("oklab(50% 25% 0%) 0px 0px 1px")).toBe(ShadowKind.Unreadable);
  });
});
