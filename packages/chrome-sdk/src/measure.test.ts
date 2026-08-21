import { describe, expect, it } from "bun:test";

import { defaultMeasure } from "./measure";

/**
 * An element whose computed style is whatever the test says. happy-dom
 * resolves almost nothing, so the properties under test have to be supplied
 * rather than set as CSS and read back.
 */
const measuredWith = (
  style: Partial<CSSStyleDeclaration>,
  size?: { width: number; height: number },
) => {
  const element = document.createElement("div");
  // happy-dom lays nothing out, so an element has no box unless the test gives
  // it one. Only the tests that read `visible` need that.
  if (size !== undefined) {
    element.getBoundingClientRect = () =>
      ({ height: size.height, left: 0, top: 0, width: size.width }) as DOMRect;
  }
  const computed = {
    borderTopLeftRadius: "",
    boxShadow: "none",
    filter: "none",
    opacity: "",
    pointerEvents: "auto",
    rotate: "none",
    scale: "none",
    transform: "none",
    transformOrigin: "50% 50%",
    translate: "none",
    visibility: "",
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
 * The record of what has already been said is module state that outlives any
 * one test, so every case here has to reach for something no other case uses:
 * a distinct value where the record is keyed on the value, and a distinct
 * *property* where it is keyed on the property — which is why the two cases
 * about the bound use `mix-blend-mode` and `clip-path` rather than a second
 * `filter` that would find the first already reported.
 */
const warningsFrom = (...styles: Partial<CSSStyleDeclaration>[]): string[] => {
  const warnings: string[] = [];
  // biome-ignore lint/suspicious/noConsole: capturing what the SDK reports
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
  try {
    for (const style of styles) {
      measuredWith(style);
    }
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

    it("says a window with `pointer-events: none` takes no pointer", () => {
      // The compositor hit-tests a rectangle and cannot see what the engine
      // painted over it, so a window under a menu or a browser tab would
      // swallow the click meant for them. `pointer-events` is how a page
      // already says this, so it is what gets reported.
      expect(measuredWith({ pointerEvents: "none" }).takesPointer).toBe(false);
    });

    it("takes the pointer when the value cannot be read", () => {
      // A DOM that resolves no style is not one whose windows should all be
      // unclickable: unusable is a worse failure than ignoring a style, and
      // the two look identical from outside.
      expect(measuredWith({ pointerEvents: "" }).takesPointer).toBe(true);
    });

    it("takes the pointer for the values that only narrow where it lands", () => {
      // `none` is the only value that means "not this element". Every other
      // one — the SVG-shaped `fill`, `stroke`, `painted`, `visiblePainted` —
      // still delivers the pointer to the element, and a window is not an SVG
      // shape anyway.
      expect(
        measuredWith({ pointerEvents: "visiblePainted" }).takesPointer,
      ).toBe(true);
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
      //
      // Twice over, and they are not the same sentence: the parser fell over
      // on valid CSS, which someone should hear about, and the window went
      // down the copy path so that it would look right anyway, which is what
      // it cost.
      const warnings = warningsFrom({
        boxShadow: "color(display-p3 1 0 0) 0px 0px 4px",
      });
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain("cannot read");
      expect(warnings.join("\n")).toContain("display-p3");
      expect(warnings.join("\n")).toContain("copied");
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

    it("reads the independent rotate property, not just `transform`", () => {
      // `rotate: 45deg` is not reported in `getComputedStyle(...).transform`,
      // so an element written that way turns in the page while the compositor
      // draws the window square — a silent disagreement rather than an error.
      const { transform } = measuredWith({ rotate: "90deg" });
      expect(transform.slice(0, 4).map(Math.round)).toStrictEqual([
        0, 1, -1, 0,
      ]);
    });

    it("reads the independent scale property too", () => {
      expect(
        measuredWith({ scale: "2 3" }).transform.slice(0, 4).map(Math.round),
      ).toStrictEqual([2, 0, 0, 3]);
    });

    it("survives the centring idiom, which resolves to a percentage", () => {
      // `translate` keeps its percentages in the computed value, where
      // `transform` does not — and a matrix cannot be built from a relative
      // length. Measuring runs on every resize and every pointer move, so a
      // throw here stops a window being placed at all.
      expect(() => measuredWith({ translate: "-50% -50%" })).not.toThrow();
    });

    it("turns a window the way an axis rotation turns it", () => {
      // `rotate` takes an axis as well as an angle, and CSS spells that with a
      // different function than the plain angle form. Emitting the wrong one
      // leaves the window square while the page turns it.
      const [a, b, c, d] = measuredWith({ rotate: "x 45deg" }).transform;
      expect([a, b, c]).toStrictEqual([1, 0, 0]);
      expect(d).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it("reads the vector form of an axis rotation as well as the keyword", () => {
      const [a, b, c, d] = measuredWith({ rotate: "1 0 0 45deg" }).transform;
      expect([a, b, c]).toStrictEqual([1, 0, 0]);
      expect(d).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it("reads a three-component scale, which is spelled differently again", () => {
      expect(
        measuredWith({ scale: "2 3 4" }).transform.slice(0, 4).map(Math.round),
      ).toStrictEqual([2, 0, 0, 3]);
    });

    it("composes the independent properties in the order CSS applies them", () => {
      // CSS applies translate, then rotate, then scale, then `transform`. The
      // order is not a detail: a quarter turn and a stretch compose to
      // different matrices each way round, so a window using both lands
      // somewhere else entirely if they are multiplied backwards.
      const { transform } = measuredWith({ rotate: "90deg", scale: "2 1" });

      // Turn-then-stretch. The other order would give [0, 1, -2, 0].
      expect(transform.slice(0, 4).map(Math.round)).toStrictEqual([
        0, 2, -1, 0,
      ]);
    });

    it("says so when it cannot read a rotate the element asked for", () => {
      // The fall-through: a shape none of the forms account for. Returning
      // identity in silence is the failure this function exists to prevent, so
      // it must not be how the function itself fails.
      const warnings = warningsFrom({ rotate: "1 0 0" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("rotate");
    });

    it("says when a style costs the window the native path", () => {
      // Nothing looks broken — the engine draws the window exactly as asked.
      // What it costs is a readback and a socket hop per frame, and a single
      // rule can put every window on the desktop there.
      const warnings = warningsFrom({ filter: "blur(4px)" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("filter");
      expect(warnings[0]).toContain("copied");
    });

    it("takes a window off the native path for a style it cannot draw", () => {
      // The whole point of naming them: the compositor's shaders have no
      // filter, so this window is drawn by the engine instead — one window,
      // not the desktop.
      expect(measuredWith({ filter: "blur(4px)" }).native).toBe(false);
    });

    it("keeps a window on the native path when it can draw every style", () => {
      // The copy path is the expensive one. Falling back for a window that
      // needs nothing would cost a readback per frame to draw the same
      // picture.
      expect(
        measuredWith({ borderTopLeftRadius: "8px", opacity: "0.5" }).native,
      ).toBe(true);
    });

    it("keeps a window whose transform it could not read on the native path", () => {
      // The one unreadable value that does not hand the window over, and the
      // reason is that it cannot happen: `asRotate` and `asScale` between them
      // cover every form a computed `rotate` or `scale` can take, so this
      // branch is a floor under a browser that computes something CSS does not
      // define. An unreadable shadow *colour* is the opposite — real CSS this
      // does not read yet — and that one does hand the window over.
      //
      // The pointer decides it either way. `surfaceLocal` inverts this same
      // matrix to map a click, so a transform this cannot read maps clicks to
      // the wrong place on both paths. The copy path would buy a right-looking
      // window that still could not be used, in exchange for a readback per
      // frame on every window in a browser we had not caught up with.
      expect(measuredWith({ rotate: "9 9 9" }).native).toBe(true);
    });

    it("says the same property once, however many values it takes", () => {
      // A `transition` on `filter` mints a new computed value every frame.
      // Keying the record on the value would burn all thirty-two entries
      // inside a second and silence everything reported after them.
      expect(
        warningsFrom({ mixBlendMode: "multiply" }, { mixBlendMode: "screen" }),
      ).toHaveLength(1);
    });

    it("does not call an effect it cannot draw an unreadable one", () => {
      // Different news. One says the SDK fell over on valid CSS, which is a
      // bug worth reporting upstream; the other says the compositor has no
      // counterpart, which is not. Telling an author their filter was a
      // deliberate omission when it in fact failed to parse sends them
      // looking in the wrong place.
      expect(warningsFrom({ clipPath: "circle(40%)" })[0]).toContain(
        "cannot draw",
      );
      expect(warningsFrom({ rotate: "1 0 0 0 45deg" })[0]).toContain(
        "cannot read",
      );
    });

    it("says nothing about a window it can draw as asked", () => {
      expect(
        warningsFrom({ borderTopLeftRadius: "8px", opacity: "0.5" }),
      ).toStrictEqual([]);
    });

    it("takes a hidden window off the stage, not just an empty one", () => {
      // `visibility: hidden` keeps the layout box, so the element still
      // measures as a size and every other signal says to draw it. Reading
      // only the size shows a window the page asked to hide — which is worse
      // than dropping an effect, because the disagreement is total.
      expect(
        measuredWith({ visibility: "hidden" }, { height: 50, width: 100 })
          .visible,
      ).toBe(false);
    });

    it("takes a collapsed window off the stage too", () => {
      // `collapse` is the third value and means `hidden` on anything that is
      // not a table row or column, which a window never is. It keeps its box
      // just the same, so it lands in the state the size check cannot see.
      expect(
        measuredWith({ visibility: "collapse" }, { height: 50, width: 100 })
          .visible,
      ).toBe(false);
    });

    it("keeps a window whose visibility was never resolved", () => {
      // Absent is not hidden. Treating it as hidden would take every window
      // off the stage in a DOM implementation that computes nothing.
      expect(measuredWith({}, { height: 50, width: 100 }).visible).toBe(true);
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
