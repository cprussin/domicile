import { describe, expect, it } from "bun:test";

import { defaultMeasure } from "./measure";

/** A computed style with nothing set, plus whatever the case cares about. */
const blankStyle = (style: Partial<CSSStyleDeclaration>): CSSStyleDeclaration =>
  ({
    rotate: "none",
    scale: "none",
    transform: "none",
    translate: "none",
    visibility: "",
    ...style,
  }) as CSSStyleDeclaration;

/**
 * An element whose computed style is whatever the test says. happy-dom
 * resolves almost nothing, so the properties under test have to be supplied
 * rather than set as CSS and read back.
 *
 * The stub answers *every* element with the same style, not just this one, so
 * it is only honest while the fixture has nothing above it. It does not: the
 * element is never inserted, so `defaultMeasure`'s walk up the flat tree ends
 * immediately and the one style is the only one read. Give a fixture here a
 * parent and each of these cases silently starts composing its transform once
 * per ancestor — `scale(2)` measured as `scale(4)` — with nothing in the
 * failure to say why. A case that wants ancestors wants `measuredInside`,
 * which keys a style per element.
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
  const computed = blankStyle(style);
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
 * one test, so every case here has to reach for a value no other case uses:
 * the record is keyed on the property and the computed value together, so a
 * case that reused another's `rotate` would find it already reported and see
 * nothing.
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

/**
 * A `<domicile-app>` inside a chain of ancestors, each with its own computed
 * style. The shared helper above answers every element with one style, which
 * is what the single-element cases want and the opposite of what these do.
 *
 * `ancestors` is outermost first, so the array reads the way the DOM nests.
 * An element the map does not know is a bug in the test rather than a case to
 * absorb, so it throws instead of defaulting.
 */
const measuredInside = (
  ancestors: readonly Partial<CSSStyleDeclaration>[],
  own: Partial<CSSStyleDeclaration> = {},
) => {
  const styles = new Map<Element, Partial<CSSStyleDeclaration>>();
  const described = (style: Partial<CSSStyleDeclaration>): HTMLElement => {
    const box = document.createElement("div");
    styles.set(box, style);
    return box;
  };

  let parent: HTMLElement | undefined;
  for (const style of ancestors) {
    const box = described(style);
    parent?.append(box);
    parent = box;
  }
  const element = described(own);
  parent?.append(element);

  return measuredAnswering(styles, element);
};

/**
 * Measure `element` with `getComputedStyle` answering from `styles`.
 *
 * An element the map does not name throws rather than defaulting. A default
 * would let a walk that visited the *wrong* element pass by answering it
 * blankly, which is the failure every case using this is about.
 */
const measuredAnswering = (
  styles: ReadonlyMap<Element, Partial<CSSStyleDeclaration>>,
  element: HTMLElement,
) => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((of: Element) => {
    const style = styles.get(of);
    if (style === undefined) {
      throw new Error("the walk asked about an element the test did not set");
    }
    return blankStyle(style);
  }) as typeof original;
  try {
    return defaultMeasure(element);
  } finally {
    globalThis.getComputedStyle = original;
  }
};

describe("defaultMeasure", () => {
  describe("what it reads off an element", () => {
    it("says it once, not once per measurement", () => {
      // Measuring happens on every frame, so a value reported each time would
      // bury the console the moment a window was on screen at all.
      const style = { rotate: "sideways 45deg" };
      expect(warningsFrom(style)).toHaveLength(1);
      expect(warningsFrom(style)).toStrictEqual([]);
    });

    it("reads the independent rotate property, not just `transform`", () => {
      // `rotate: 45deg` is not reported in `getComputedStyle(...).transform`,
      // so an element written that way turns in the page while a reading that
      // took only `transform` maps a click as if it had not — a silent
      // disagreement rather than an error.
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
      // length. Measuring runs on every frame and every pointer move, so a
      // throw here stops a window being sized at all.
      expect(() => measuredWith({ translate: "-50% -50%" })).not.toThrow();
    });

    it("turns a window the way an axis rotation turns it", () => {
      // `rotate` takes an axis as well as an angle, and CSS spells that with a
      // different function than the plain angle form. Emitting the wrong one
      // maps clicks square while the page turns the window.
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

    it("says nothing about a window it can read every style of", () => {
      expect(warningsFrom({ rotate: "30deg", scale: "2 3" })).toStrictEqual([]);
    });

    it("reports a hidden window as invisible, not just an empty one", () => {
      // `visibility: hidden` keeps the layout box, so the element still
      // measures as a size while the page has said it is not to be seen.
      // Reading only the size configures — and so redraws — a client nobody
      // is looking at.
      expect(
        measuredWith({ visibility: "hidden" }, { height: 50, width: 100 })
          .visible,
      ).toBe(false);
    });

    it("reports a collapsed window as invisible too", () => {
      // `collapse` is the third value and means `hidden` on anything that is
      // not a table row or column, which a window never is. It keeps its box
      // just the same, so it lands in the state the size check cannot see.
      expect(
        measuredWith({ visibility: "collapse" }, { height: 50, width: 100 })
          .visible,
      ).toBe(false);
    });

    it("keeps a window whose visibility was never resolved", () => {
      // Absent is not hidden. Treating it as hidden would leave every client
      // unconfigured in a DOM implementation that computes nothing.
      expect(measuredWith({}, { height: 50, width: 100 }).visible).toBe(true);
    });
  });
});

describe("how many unreadable transforms it will report", () => {
  // Last in the file on purpose: this fills the module's record of what it has
  // already said, so a test after it would find the reporting exhausted.
  it("stops rather than growing without a bound", () => {
    // The key is the whole computed string, and a `transition` on `rotate`
    // produces a new one every frame — so the record has to stop somewhere or
    // it is a leak on a path that runs per frame.
    const attempts = 40;
    const warned = Array.from({ length: attempts }, (_, index) =>
      warningsFrom({ rotate: `axis${index.toString()} 45deg` }),
    ).flat();

    expect(warned.length).toBeGreaterThan(0);
    expect(warned.length).toBeLessThan(attempts);
  });
});

describe("transforms above the element", () => {
  it("follows a container that turned, not just its own transform", () => {
    // `getBoundingClientRect` reports an axis-aligned box, so a parent's
    // rotation is invisible in it and the element's own transform cannot
    // explain it. A click on a window inside a rotated container reached the
    // client at the coordinate it would have had if nothing had turned.
    const measured = measuredInside([{ transform: "rotate(90deg)" }]);

    const [a, b, c, d] = measured.transform;
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(1, 6);
    expect(c).toBeCloseTo(-1, 6);
    expect(d).toBeCloseTo(0, 6);
  });

  it("composes the whole chain, outermost last", () => {
    // Two ancestors and the element itself, each contributing. Order matters:
    // an ancestor's transform applies to the result of everything inside it,
    // so multiplying the other way round turns a scale-then-rotate into a
    // rotate-then-scale, which differs whenever the scale is not uniform.
    const measured = measuredInside(
      [{ transform: "scale(2, 1)" }, { transform: "rotate(90deg)" }],
      { transform: "scale(3, 1)" },
    );

    // scale(2,1) · rotate(90) · scale(3,1), as [[a, c], [b, d]]:
    //   [[2, 0], [0, 1]] · [[0, -1], [1, 0]] · [[3, 0], [0, 1]] = [[0, -2], [3, 0]]
    const [a, b, c, d] = measured.transform;
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(3, 6);
    expect(c).toBeCloseTo(-2, 6);
    expect(d).toBeCloseTo(0, 6);
  });
});

describe("where an element is painted, rather than where it is written", () => {
  /** An element whose flat-tree parent is a slot rather than its writer. */
  const slottedInto = (element: Element, slot: HTMLSlotElement): void => {
    // Assigned by hand: happy-dom does not distribute to slots, and the
    // property is a getter with no seam to inject.
    Object.defineProperty(element, "assignedSlot", { value: slot });
  };

  it("crosses a shadow boundary to the element that holds it", () => {
    // `parentElement` is null at a shadow root, so a walk that used it stopped
    // there and mapped the pointer as if nothing above had turned.
    // `<domicile-app>` is a custom element, so a chrome that puts one in a
    // shadow tree is not exotic.
    const turned = document.createElement("div");
    const host = document.createElement("div");
    turned.append(host);
    const element = document.createElement("div");
    host.attachShadow({ mode: "open" }).append(element);
    const measured = measuredAnswering(
      new Map([
        [element, {}],
        [host, {}],
        [turned, { transform: "rotate(90deg)" }],
      ]),
      element,
    );

    const [a, b] = measured.transform;
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(1, 6);
  });

  it("stops at an ancestor painted in the top layer", () => {
    // A modal dialog is painted outside its ancestors, so their transforms do
    // not apply to it. Walking up as if they did maps a click through a
    // transform that never touched the window — a case that was right before
    // the walk existed.
    const turned = document.createElement("div");
    const modal = document.createElement("div");
    // happy-dom has no top layer, so the selector is what has to be answered.
    modal.matches = ((selector: string) =>
      selector.includes(":modal")) as Element["matches"];
    turned.append(modal);
    const element = document.createElement("div");
    modal.append(element);
    const measured = measuredAnswering(
      new Map([
        [element, {}],
        [modal, { transform: "scale(2, 3)" }],
        [turned, { transform: "rotate(90deg)" }],
      ]),
      element,
    );

    // The modal's own transform counts — the element is inside it — and the
    // rotation above it does not.
    expect(measured.transform.slice(0, 4)).toStrictEqual([2, 0, 0, 3]);
  });

  it("is painted where its slot is, not where it is written", () => {
    // Slotted content is drawn in the slot's place in the tree, so the
    // transforms above it are the slot's ancestors' — the element's written
    // parent never touches it. `parentElement` reports the writer, which is
    // what makes this its own case rather than the shadow-host one.
    const writer = document.createElement("div");
    const element = document.createElement("div");
    writer.append(element);
    const scaled = document.createElement("div");
    const slot = document.createElement("slot");
    scaled.append(slot);
    slottedInto(element, slot);
    const measured = measuredAnswering(
      new Map<Element, Partial<CSSStyleDeclaration>>([
        [element, {}],
        [scaled, { transform: "scale(2, 3)" }],
        [slot, {}],
        [writer, { transform: "rotate(90deg)" }],
      ]),
      element,
    );

    expect(measured.transform.slice(0, 4)).toStrictEqual([2, 0, 0, 3]);
  });

  it("stops at an ancestor painted in the top layer's popover half", () => {
    // The other half of the same selector list. Asked as one list, so an
    // engine that knows `:modal` and not `:popover-open` throws on the whole
    // thing — and a suite that only ever answers `:modal` cannot tell that
    // half from a selector that was never asked for.
    const turned = document.createElement("div");
    const popover = document.createElement("div");
    popover.matches = ((selector: string) =>
      selector.includes(":popover-open")) as Element["matches"];
    turned.append(popover);
    const element = document.createElement("div");
    popover.append(element);
    const measured = measuredAnswering(
      new Map([
        [element, {}],
        [popover, { transform: "scale(5, 7)" }],
        [turned, { transform: "rotate(90deg)" }],
      ]),
      element,
    );

    expect(measured.transform.slice(0, 4)).toStrictEqual([5, 0, 0, 7]);
  });

  it("takes nothing from above an element that is itself in the top layer", () => {
    // The window *is* the dialog. Its ancestors' transforms do not reach it,
    // so the walk does not start — distinct from stopping at an ancestor that
    // is in the top layer, where that ancestor's own transform still counts.
    const turned = document.createElement("div");
    const element = document.createElement("div");
    element.matches = ((selector: string) =>
      selector.includes(":modal")) as Element["matches"];
    turned.append(element);
    const measured = measuredAnswering(
      new Map([
        [element, { transform: "scale(4, 5)" }],
        [turned, { transform: "rotate(90deg)" }],
      ]),
      element,
    );

    expect(measured.transform.slice(0, 4)).toStrictEqual([4, 0, 0, 5]);
  });
});
