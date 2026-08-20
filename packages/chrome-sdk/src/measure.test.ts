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
    boxShadow: "none",
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

/**
 * What `defaultMeasure` writes to the console while measuring an element.
 *
 * Each case uses a distinct `box-shadow`, because the once-per-value record is
 * module state that outlives any one test.
 */
const warningsFrom = (style: Partial<CSSStyleDeclaration>): string[] => {
  const warnings: string[] = [];
  // biome-ignore lint/suspicious/noConsole: capturing what the SDK reports
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
  try {
    measuredWith(style);
  } finally {
    console.warn = original;
  }
  return warnings;
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

    it("reports the box-shadow the compositor should cast", () => {
      expect(
        measuredWith({ boxShadow: "rgba(0, 0, 0, 0.5) 4px 8px 12px 2px" })
          .shadow,
      ).toEqual({ blur: 12, color: [0, 0, 0, 0.5], dx: 4, dy: 8, spread: 2 });
    });

    it("reports no shadow for an element that casts none", () => {
      expect(measuredWith({}).shadow).toBeUndefined();
    });

    it("says so when it cannot read a shadow the element asked for", () => {
      // Dropping it in silence is indistinguishable from the compositor not
      // drawing at all, which is the version of this bug nobody can debug.
      const warnings = warningsFrom({
        boxShadow: "color(display-p3 1 0 0) 0px 0px 4px",
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("display-p3");
    });

    it("says nothing about a shadow it declined on purpose", () => {
      // An `inset` shadow is read, understood, and deliberately not drawn.
      // Reporting it tells the author their CSS is broken when it is not.
      expect(
        warningsFrom({ boxShadow: "rgb(0, 0, 0) 0px 0px 8px inset" }),
      ).toStrictEqual([]);
      expect(warningsFrom({ boxShadow: "none" })).toStrictEqual([]);
      expect(
        warningsFrom({ boxShadow: "rgb(0, 0, 0) 1px 2px 3px" }),
      ).toStrictEqual([]);
    });

    it("says it once, not once per measurement", () => {
      // Measuring happens on every resize, so a value reported each time would
      // bury the console the moment a window was dragged.
      const style = { boxShadow: "color(display-p3 0 1 0) 0px 0px 4px" };
      expect(warningsFrom(style)).toHaveLength(1);
      expect(warningsFrom(style)).toStrictEqual([]);
    });

    it("refuses a negative radius rather than passing it to a shader", () => {
      expect(measuredWith({ borderTopLeftRadius: "-4px" }).cornerRadius).toBe(
        0,
      );
    });
  });
});

describe("how many unreadable shadows it will report", () => {
  // Last in the file on purpose: this fills the module's record of what it has
  // already said, so a test after it would find the reporting exhausted.
  it("stops rather than growing without a bound", () => {
    // The key is the whole computed string, and a `transition` on `box-shadow`
    // produces a new one every frame — so the record has to stop somewhere or
    // it is a leak on a path that runs per resize.
    const attempts = 40;
    const warned = Array.from({ length: attempts }, (_, index) =>
      warningsFrom({ boxShadow: `lab(${index} 0 0) 0px 0px 4px` }),
    ).flat();

    expect(warned.length).toBeGreaterThan(0);
    expect(warned.length).toBeLessThan(attempts);
  });
});
