import { describe, expect, it } from "bun:test";

import { defaultMeasure } from "./measure";

/** A computed style with nothing set, plus whatever the case cares about. */
const blankStyle = (style: Partial<CSSStyleDeclaration>): CSSStyleDeclaration =>
  ({
    perspective: "none",
    rotate: "none",
    scale: "none",
    transform: "none",
    transformStyle: "flat",
    translate: "none",
    ...style,
  }) as CSSStyleDeclaration;

/**
 * Measures a detached element with a stubbed computed style, since happy-dom
 * resolves almost no CSS.
 *
 * The stub returns the same style for every element, so the element must have
 * no parent. Use `measuredInside` for cases with ancestors.
 */
const measuredWith = (style: Partial<CSSStyleDeclaration>, zoom?: number) => {
  const element = document.createElement("div");
  // happy-dom has no `currentCSSZoom`, so define it on the element.
  if (zoom !== undefined) {
    Object.defineProperty(element, "currentCSSZoom", { value: zoom });
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
 * Collects console warnings logged while `measuring` runs.
 *
 * Each warning is logged once per module, keyed on property and value, so
 * every case must use a value no other case uses.
 */
const warningsWhile = (measuring: () => void): string[] => {
  const warnings: string[] = [];
  // biome-ignore lint/suspicious/noConsole: capturing what the SDK reports
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
  try {
    measuring();
  } finally {
    console.warn = original;
  }
  return warnings;
};

const warningsFrom = (...styles: Partial<CSSStyleDeclaration>[]): string[] =>
  warningsWhile(() => {
    for (const style of styles) {
      measuredWith(style);
    }
  });

/**
 * Measures an element nested in `ancestors` (outermost first), each with its
 * own computed style.
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
 * Measures `element` with `getComputedStyle` answering from `styles`.
 *
 * Throws for an unknown element so a walk visiting the wrong element fails.
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
      // Measurement runs on every pointer move, so warn only once.
      const style = { rotate: "sideways 45deg" };
      expect(warningsFrom(style)).toHaveLength(1);
      expect(warningsFrom(style)).toStrictEqual([]);
    });

    it("reads the independent rotate property, not just `transform`", () => {
      // Computed `transform` does not include the `rotate` property.
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

    it("survives the centering idiom, which resolves to a percentage", () => {
      // Computed `translate` keeps percentages, which `DOMMatrix` rejects. A
      // throw here would drop pointer input.
      expect(() => measuredWith({ translate: "-50% -50%" })).not.toThrow();
    });

    it("turns a window the way an axis rotation turns it", () => {
      // An axis rotation needs `rotate3d`, not `rotate`.
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
      // CSS applies translate, rotate, scale, then `transform`. Rotation and
      // non-uniform scale do not commute.
      const { transform } = measuredWith({ rotate: "90deg", scale: "2 1" });

      // Turn-then-stretch. The other order would give [0, 1, -2, 0].
      expect(transform.slice(0, 4).map(Math.round)).toStrictEqual([
        0, 2, -1, 0,
      ]);
    });

    it("says so when it cannot read a rotate the element asked for", () => {
      // An unrecognized shape must warn, not silently become identity.
      const warnings = warningsFrom({ rotate: "1 0 0" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("rotate");
    });

    it("says nothing about a window it can read every style of", () => {
      expect(warningsFrom({ rotate: "30deg", scale: "2 3" })).toStrictEqual([]);
    });
  });
});

describe("a zoom over the window, which is not a transform", () => {
  it("maps a click through the zoom in effect over the window", () => {
    // `zoom` scales the box without appearing in any transform.
    expect(measuredWith({}, 2).transform.slice(0, 4)).toStrictEqual([
      2, 0, 0, 2,
    ]);
  });

  it("composes the zoom with the window's own transform", () => {
    // Zoom and transform multiply; neither replaces the other.
    expect(
      measuredWith({ scale: "3" }, 2).transform.slice(0, 4).map(Math.round),
    ).toStrictEqual([6, 0, 0, 6]);
  });
});

describe("a projection no affine can express", () => {
  it("says so when a perspective above the window projects it", () => {
    // A container's `perspective` projects a child turned out of the plane.
    // No affine can express that, so it must warn.
    const warnings = warningsWhile(() => {
      measuredInside([{ perspective: "501px" }], {
        transform: "rotateY(40deg)",
      });
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("perspective");
  });

  it("says so when the window's own transform carries the perspective", () => {
    // `perspective()` in the element's own transform also projects.
    const warnings = warningsWhile(() => {
      measuredWith({ transform: "perspective(601px) rotateY(40deg)" });
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("transform");
  });

  it("says nothing about a 3D turn with no perspective over it", () => {
    // Without perspective, CSS draws the 2D part, which the mapping uses.
    expect(
      warningsWhile(() => {
        measuredWith({ transform: "rotateX(35deg)" });
      }),
    ).toStrictEqual([]);
  });

  it("says nothing when a flat ancestor flattens the turn first", () => {
    // The default `transform-style: flat` flattens the turn before the
    // perspective applies, so the affine is correct.
    expect(
      warningsWhile(() => {
        measuredInside([{ perspective: "802px" }, {}], {
          transform: "rotateX(35deg)",
        });
      }),
    ).toStrictEqual([]);
  });

  it("says so when preserve-3d carries the turn up to the perspective", () => {
    // `preserve-3d` passes the turn up to the perspective.
    const warnings = warningsWhile(() => {
      measuredInside(
        [{ perspective: "903px" }, { transformStyle: "preserve-3d" }],
        { transform: "rotateX(35deg)" },
      );
    });

    expect(warnings).toHaveLength(1);
  });
});

describe("how many unreadable transforms it will report", () => {
  // Must run after the other warning cases: it fills the module's capped
  // warning set.
  it("stops rather than growing without a bound", () => {
    // An animated value yields a new key every frame, so the set is capped.
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
    // `getBoundingClientRect` is axis-aligned, so it hides a parent's
    // rotation.
    const measured = measuredInside([{ transform: "rotate(90deg)" }]);

    const [a, b, c, d] = measured.transform;
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(1, 6);
    expect(c).toBeCloseTo(-1, 6);
    expect(d).toBeCloseTo(0, 6);
  });

  it("composes the whole chain, outermost last", () => {
    // An ancestor's transform applies after its descendants'. Reversing the
    // order changes the result for non-uniform scales.
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
  /** Assigns `element` to `slot`. */
  const slottedInto = (element: Element, slot: HTMLSlotElement): void => {
    // happy-dom does not distribute to slots.
    Object.defineProperty(element, "assignedSlot", { value: slot });
  };

  it("crosses a shadow boundary to the element that holds it", () => {
    // `parentElement` is null at a shadow root.
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
    // A modal is painted outside its ancestors, so their transforms do not
    // apply.
    const turned = document.createElement("div");
    const modal = document.createElement("div");
    // happy-dom has no top layer, so stub the selector match.
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

    // The modal's own transform applies; the rotation above it does not.
    expect(measured.transform.slice(0, 4)).toStrictEqual([2, 0, 0, 3]);
  });

  it("is painted where its slot is, not where it is written", () => {
    // Slotted content takes the slot's ancestors' transforms, not those of
    // its `parentElement`.
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
    // Checks the `:popover-open` half of the selector list.
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
    // The window itself is the dialog, so no ancestor transform applies.
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
