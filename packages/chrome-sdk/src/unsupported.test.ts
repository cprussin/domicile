import { describe, expect, it } from "bun:test";

import { unsupportedEffects } from "./unsupported";

/**
 * A computed style that resolves exactly the properties named, the way a
 * browser does — everything else reads empty rather than defaulting, which is
 * what `getPropertyValue` returns for a property an implementation does not
 * resolve.
 */
const styleOf = (properties: Record<string, string>): CSSStyleDeclaration =>
  properties as unknown as CSSStyleDeclaration;

const propertiesIn = (properties: Record<string, string>): string[] =>
  unsupportedEffects(styleOf(properties)).map((effect) => effect.property);

const PROPERTY_KEYS: Record<string, string> = {
  "backdrop-filter": "backdropFilter",
  "clip-path": "clipPath",
  filter: "filter",
  "mask-image": "maskImage",
  "mix-blend-mode": "mixBlendMode",
};

const NOT_INITIAL: Record<string, string> = {
  "backdrop-filter": "blur(2px)",
  "clip-path": "circle(40%)",
  filter: "blur(4px)",
  "mask-image": "linear-gradient(black, transparent)",
  "mix-blend-mode": "multiply",
};

/** Every row's property set to the value that means "not asked for". */
const AT_INITIAL: Record<string, string> = {
  backdropFilter: "none",
  backfaceVisibility: "visible",
  clipPath: "none",
  filter: "none",
  maskImage: "none",
  mixBlendMode: "normal",
};

describe("unsupportedEffects", () => {
  it("names nothing for a window the compositor can draw as asked", () => {
    expect(
      propertiesIn({
        borderBottomLeftRadius: "8px",
        borderBottomRightRadius: "8px",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        boxShadow: "rgb(0, 0, 0) 0px 4px 8px",
        filter: "none",
        mixBlendMode: "normal",
        opacity: "0.5",
        transform: "matrix(1, 0, 0, 1, 0, 0)",
      }),
    ).toStrictEqual([]);
  });

  it("knows the whole list of effects with no counterpart", () => {
    // The table is data, and a row with no test is what a later tidy-up
    // deletes without anyone noticing. Naming them here means removing one is
    // a failing test rather than a window that quietly stops being reported.
    expect(
      [
        "backdrop-filter",
        "clip-path",
        "filter",
        "mask-image",
        "mix-blend-mode",
      ].map((property) =>
        propertiesIn({
          ...AT_INITIAL,
          // Each in turn set to something that is not its initial value; the
          // rest stay at theirs, so exactly one row can fire.
          [PROPERTY_KEYS[property] as string]: NOT_INITIAL[property] as string,
        }),
      ),
    ).toStrictEqual([
      ["backdrop-filter"],
      ["clip-path"],
      ["filter"],
      ["mask-image"],
      ["mix-blend-mode"],
    ]);
  });

  it("names an effect the shader has no equivalent for", () => {
    expect(propertiesIn({ filter: "blur(4px)" })).toStrictEqual(["filter"]);
  });

  it("names every unsupported effect, not just the first", () => {
    expect(
      propertiesIn({
        clipPath: "circle(40%)",
        filter: "blur(4px)",
        mixBlendMode: "multiply",
      }).sort(),
    ).toStrictEqual(["clip-path", "filter", "mix-blend-mode"]);
  });

  it("says which value was at fault, not only which property", () => {
    // A property name alone tells an author what they wrote. The value is what
    // tells them which rule wrote it, in a stylesheet with several.
    const [dropped] = unsupportedEffects(styleOf({ filter: "blur(4px)" }));
    expect(dropped?.value).toBe("blur(4px)");
  });

  it("says nothing about a property the DOM did not resolve", () => {
    // An unresolved property reads empty, which is not the same as one set to
    // its initial value — treating it as set would report every window in a
    // DOM implementation that computes nothing. A real `CSSStyleDeclaration`
    // gives the empty string; a stub may simply not have the key, and neither
    // is a style anyone asked for.
    expect(propertiesIn({})).toStrictEqual([]);
    expect(
      propertiesIn({ clipPath: "", filter: "", mixBlendMode: "" }),
    ).toStrictEqual([]);
  });

  it("says nothing about an inset shadow behind one the shader casts", () => {
    // The outer one is first, so the shader casts it; the inset one is drawn
    // by the engine over the top, exactly as CSS asks. Both are already right,
    // which is the one two-shadow list that stays native.
    expect(
      propertiesIn({
        boxShadow:
          "rgb(0, 0, 255) 0px 4px 8px 0px, rgb(255, 0, 0) 0px 1px 2px 0px inset",
      }),
    ).toStrictEqual([]);
  });

  it("names a second shadow, because the placement carries only one", () => {
    // The partial cases are the ones worth finding: a window with no filter is
    // obviously missing something, where a window whose second shadow was
    // dropped would just look like a window with one shadow.
    expect(
      propertiesIn({
        boxShadow: "rgb(0, 0, 0) 0px 4px 8px, rgb(255, 0, 0) 0px 8px 16px",
      }),
    ).toStrictEqual(["box-shadow"]);
  });

  it("does not mistake the commas inside a colour for another shadow", () => {
    expect(
      propertiesIn({ boxShadow: "rgba(0, 0, 0, 0.5) 0px 4px 8px" }),
    ).toStrictEqual([]);
  });

  it("names corners that differ, because only one radius is drawn", () => {
    const [dropped] = unsupportedEffects(
      styleOf({
        borderBottomLeftRadius: "0px",
        borderBottomRightRadius: "0px",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
      }),
    );
    expect(dropped?.property).toBe("border-radius");
    expect(dropped?.value).toBe("8px, 8px, 0px, 0px");
  });

  it("names a hidden backface on a window that is turned away", () => {
    // `rotateY(180deg)` carries no perspective, so `flattened` passes it — the
    // compositor keeps the six 2D terms and draws the window mirrored, while
    // CSS hides it outright. The two pictures could hardly disagree more.
    expect(
      propertiesIn({
        backfaceVisibility: "hidden",
        transform: "matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)",
      }),
    ).toStrictEqual(["backface-visibility"]);
  });

  it("reads a hidden backface on the independent rotate property too", () => {
    // An axis rotation does not appear in the computed `transform` at all, so
    // a window written this way turns in the page while a check that read only
    // `transform` saw a flat element and said nothing.
    expect(
      propertiesIn({ backfaceVisibility: "hidden", rotate: "y 180deg" }),
    ).toStrictEqual(["backface-visibility"]);
  });

  it("says nothing about a hidden backface on a window that never turns", () => {
    // By far the commonest use of the property: the old
    // promote-to-its-own-layer flicker hack, on elements that are never
    // rotated out of the plane. Both paths draw those identically, so reading
    // the property alone would move a desktop's worth of windows onto the copy
    // path to fix nothing at all.
    expect(
      propertiesIn({
        backfaceVisibility: "hidden",
        rotate: "45deg",
        transform: "matrix(1, 0, 0, 1, 0, 0)",
      }),
    ).toStrictEqual([]);
  });

  it("names a transform with perspective in it, which is drawn flat", () => {
    // Not the `perspective` property — that sets a frustum for an element's
    // descendants and says nothing about the element itself. A window really
    // drawn in perspective computes `perspective: none` and carries the
    // projection in its matrix.
    const [dropped] = unsupportedEffects(
      styleOf({
        perspective: "none",
        // `perspective(400px) rotateY(45deg)`, as Chromium computes it —
        // copied from a real browser, including the m34 term at index 11 that
        // a hand-written fixture would have left at zero.
        transform:
          "matrix3d(0.707107, 0, -0.707107, 0.00176777, 0, 1, 0, 0, 0.707107, 0, 0.707107, -0.00176777, 0, 0, 0, 1)",
      }),
    );
    expect(dropped?.property).toBe("transform");
  });

  it("says nothing about a 3D transform with no perspective in it", () => {
    // The compositor keeps the six 2D terms, which for a 3D rotation with no
    // perspective is exactly the projection CSS draws — so there is nothing
    // lost to report.
    expect(
      propertiesIn({
        transform:
          "matrix3d(1, 0, 0, 0, 0, 0.707107, 0.707107, 0, 0, -0.707107, 0.707107, 0, 0, 0, 0, 1)",
      }),
    ).toStrictEqual([]);
  });

  it("names a radius in percent, which is drawn as that many pixels", () => {
    // The nastiest of the corner cases: all four agree, so nothing looks
    // inconsistent. `50%` keeps its `%` in the computed value and the number
    // in front of it is then read as pixels, so a circle becomes a 50px
    // round-rect.
    const [dropped] = unsupportedEffects(
      styleOf({
        borderBottomLeftRadius: "50%",
        borderBottomRightRadius: "50%",
        borderTopLeftRadius: "50%",
        borderTopRightRadius: "50%",
      }),
    );
    expect(dropped?.property).toBe("border-radius");
    expect(dropped?.value).toBe("50%, 50%, 50%, 50%");
  });

  it("names a two-axis radius, whose second axis is dropped", () => {
    const [dropped] = unsupportedEffects(
      styleOf({
        borderBottomLeftRadius: "10px 20px",
        borderBottomRightRadius: "10px 20px",
        borderTopLeftRadius: "10px 20px",
        borderTopRightRadius: "10px 20px",
      }),
    );
    expect(dropped?.property).toBe("border-radius");
    // Separated, because each corner here is itself two values — four of them
    // run together is not something anyone can match against a stylesheet.
    expect(dropped?.value).toBe("10px 20px, 10px 20px, 10px 20px, 10px 20px");
  });

  it("names a shadow list whose first shadow is one the shader declines", () => {
    // The shader casts the *first* shadow, and declines an inset one — so a
    // window written this way would cast nothing while CSS casts the blue one
    // behind it. The first being undrawable does not excuse the second.
    expect(
      propertiesIn({
        boxShadow:
          "rgb(255, 0, 0) 0px 1px 2px 0px inset, rgb(0, 0, 255) 0px 4px 8px 0px",
      }),
    ).toStrictEqual(["box-shadow"]);
  });

  it("says nothing about an inset shadow, which is drawn already", () => {
    // On the native path this element has no content, so the engine paints the
    // inset shadow into the page and `present()` composites the page over the
    // client. It is the copy path that loses it, under an opaque canvas — so
    // handing the window over would buy a readback and *remove* a shadow that
    // was working.
    expect(
      propertiesIn({ boxShadow: "rgb(0, 0, 0) 0px 1px 2px 0px inset" }),
    ).toStrictEqual([]);
    expect(
      propertiesIn({
        boxShadow:
          "rgb(0, 0, 0) 0px 1px 2px 0px inset, rgb(0, 0, 255) 0px 2px 4px 0px inset",
      }),
    ).toStrictEqual([]);
  });

  it("names a shadow whose colour it cannot read, which the engine can", () => {
    // Unreadable is the SDK's gap, not CSS's: the browser draws this shadow
    // perfectly well, and the compositor would draw none at all. Handing the
    // window over is what makes the window right while the parser catches up.
    expect(
      propertiesIn({ boxShadow: "color(display-p3 1 0 0) 0px 0px 4px" }),
    ).toStrictEqual(["box-shadow"]);
  });

  it("names a calc() radius, which has no absolute number to send", () => {
    // `calc()` survives into the computed value the way `%` does, and parses
    // to nothing at all — so a window drawn natively would be drawn square.
    const [dropped] = unsupportedEffects(
      styleOf({
        borderBottomLeftRadius: "calc(10% + 2px)",
        borderBottomRightRadius: "calc(10% + 2px)",
        borderTopLeftRadius: "calc(10% + 2px)",
        borderTopRightRadius: "calc(10% + 2px)",
      }),
    );
    expect(dropped?.property).toBe("border-radius");
  });

  it("says nothing when all four corners agree", () => {
    expect(
      propertiesIn({
        borderBottomLeftRadius: "8px",
        borderBottomRightRadius: "8px",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
      }),
    ).toStrictEqual([]);
  });
});
