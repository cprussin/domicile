import { describe, expect, it } from "bun:test";

import { defaultMeasure } from "./measure";

/**
 * An element whose computed style is whatever the test says. happy-dom
 * resolves almost nothing, so the properties under test have to be supplied
 * rather than set as CSS and read back.
 */
const measuredWith = (style: Partial<CSSStyleDeclaration>) => {
  const element = document.createElement("div");
  const computed = {
    borderTopLeftRadius: "",
    opacity: "",
    transform: "none",
    transformOrigin: "50% 50%",
    zIndex: "auto",
    ...style,
  } as CSSStyleDeclaration;
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => computed) as typeof original;
  try {
    return defaultMeasure(element);
  } finally {
    globalThis.getComputedStyle = original;
  }
};

describe("defaultMeasure", () => {
  describe("how a window should be drawn", () => {
    it("reports a border-radius in pixels", () => {
      expect(measuredWith({ borderTopLeftRadius: "12px" }).cornerRadius).toBe(
        12,
      );
    });

    it("reports no rounding for an element that set none", () => {
      // An unstyled window is square. Guessing a radius would clip content
      // nobody asked to have clipped.
      expect(measuredWith({}).cornerRadius).toBe(0);
    });

    it("reports an opacity", () => {
      expect(measuredWith({ opacity: "0.4" }).opacity).toBe(0.4);
    });

    it("treats an unreadable opacity as fully opaque", () => {
      // Never as transparent: a window nobody can see is a worse failure than
      // one that ignores a style, and it is indistinguishable from the
      // compositor not drawing at all.
      expect(measuredWith({ opacity: "" }).opacity).toBe(1);
    });

    it("clamps an opacity outside the range it can mean", () => {
      expect(measuredWith({ opacity: "3" }).opacity).toBe(1);
      expect(measuredWith({ opacity: "-1" }).opacity).toBe(0);
    });

    it("refuses a negative radius rather than passing it to a shader", () => {
      expect(measuredWith({ borderTopLeftRadius: "-4px" }).cornerRadius).toBe(
        0,
      );
    });
  });
});
