import { describe, expect, it } from "bun:test";
import panda from "@pandacss/preset-panda";

import { domicilePreset } from "./pandacss-preset";

/**
 * The colors that are a pair rather than a mix — see the note beside them in
 * the preset. Each is written twice, once for each ground, and each of those
 * has to be legible on the ground it was written for.
 *
 * The derived tokens are not here and cannot be: they are `color-mix(...)` of
 * foreground and background, resolved by the engine at CSS time, so there is
 * no hex to measure until a browser has one.
 */
const PER_THEME = ["accent", "danger", "success", "warning"] as const;

/**
 * WCAG's floor for text somebody has to read, which is what these are: an
 * accent is the color a launcher marks a match in and a browser draws a lock
 * in, not decoration.
 */
const READABLE = 4.5;

/** Which of a pair a theme takes: Panda's own name for each of the two. */
type Theme = "_light" | "base";

describe("the domicile preset", () => {
  it("draws every colored thing against the light ground legibly", () => {
    expect(unreadableOn("_light")).toStrictEqual([]);
  });

  it("draws every colored thing against the dark ground legibly", () => {
    expect(unreadableOn("base")).toStrictEqual([]);
  });
});

/** Which of the pairs fall short on `theme`'s ground, and by how much. */
const unreadableOn = (theme: Theme): readonly string[] => {
  const ground = colorFor("background", theme);
  return PER_THEME.filter(
    (name) => contrast(colorFor(name, theme), ground) < READABLE,
  ).map(
    (name) => `${name} ${contrast(colorFor(name, theme), ground).toFixed(2)}:1`,
  );
};

/** What the preset says `name` is on `theme`'s ground, as a hex. */
const colorFor = (name: string, theme: Theme): string => {
  const colors = at(
    at(at(domicilePreset, "theme"), "extend"),
    "semanticTokens",
  );
  const reference = at(at(at(at(colors, "colors"), name), "value"), theme);
  if (typeof reference === "string") {
    return palette(reference);
  } else {
    throw new Error(`the preset has no ${theme} ${name} to measure`);
  }
};

/** A `{colors.cyan.600}` reference, as the hex the palette gives it. */
const palette = (reference: string): string => {
  const named = /^\{colors\.(?<family>[a-z]+)\.(?<step>\d+)\}$/u.exec(
    reference,
  );
  const family = named?.groups?.family;
  const step = named?.groups?.step;
  const hex =
    family === undefined || step === undefined
      ? undefined
      : at(at(at(panda.theme.tokens.colors, family), step), "value");
  if (typeof hex === "string") {
    return hex;
  } else {
    throw new Error(`${reference} is not a color the palette names`);
  }
};

/**
 * One step into a token tree, without saying what shape the tree is.
 *
 * The preset's own types describe what Panda will accept rather than what
 * this file wrote down, so walking them by key is a type error and a cast
 * would only silence it. This reads the object the way the test knows it to
 * be and answers `undefined` for anything else, which the callers above turn
 * into a failure that names the token.
 */
const at = (source: unknown, key: string): unknown =>
  typeof source === "object" && source !== null && key in source
    ? Reflect.get(source, key)
    : undefined;

/**
 * How far apart two colors are, by WCAG's contrast ratio: 1 for a pair that
 * is the same color, 21 for black on white.
 */
const contrast = (one: string, other: string): number => {
  const [brighter, darker] = [luminance(one), luminance(other)].sort(
    (first, second) => second - first,
  );
  return ((brighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

/** The relative luminance of a `#rrggbb`, which is what a ratio is taken of. */
const luminance = (hex: string): number => {
  const [red, green, blue] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.039_28
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};
