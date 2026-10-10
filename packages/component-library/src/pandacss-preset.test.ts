import { describe, expect, it } from "bun:test";
import panda from "@pandacss/preset-panda";

import { domicilePreset } from "./pandacss-preset";

/**
 * Colors with a separate value per theme.
 *
 * `color-mix(...)` tokens are left out because they have no hex until a
 * browser resolves them.
 */
const PER_THEME = [
  "accent",
  "danger",
  "private",
  "success",
  "warning",
] as const;

/** WCAG AA contrast for normal text. These colors are used for text. */
const READABLE = 4.5;

/** Panda's condition name for each theme. */
type Theme = "_light" | "base";

describe("the domicile preset", () => {
  it("draws every colored thing against the light ground legibly", () => {
    expect(unreadableOn("_light")).toStrictEqual([]);
  });

  it("draws every colored thing against the dark ground legibly", () => {
    expect(unreadableOn("base")).toStrictEqual([]);
  });

  it("holds the theme wipe at its start while windows turn", () => {
    // `flipThemeWithAnimation` sets `data-theme-holding` until the windows
    // have repainted behind the old frame.
    expect(
      at(
        at(domicilePreset, "globalCss"),
        "html[data-theme-holding]::view-transition-new(root)",
      ),
    ).toStrictEqual({ animationPlayState: "paused" });
  });

  describe("under high contrast", () => {
    it("draws text further from the light ground", () => {
      expect(textContrast("_light", true)).toBeGreaterThan(
        textContrast("_light", false),
      );
    });

    it("draws text further from the dark ground", () => {
      expect(textContrast("base", true)).toBeGreaterThan(
        textContrast("base", false),
      );
    });
  });
});

/** The contrast of `foreground` on `background` in `theme`. */
const textContrast = (theme: Theme, high: boolean): number =>
  contrast(
    high ? highContrastForeground(theme) : colorFor("foreground", theme),
    colorFor("background", theme),
  );

/** The hex value of `foreground` in `theme` under `_contrastHigh`. */
const highContrastForeground = (theme: Theme): string => {
  const value = at(
    at(
      at(
        at(at(at(domicilePreset, "theme"), "extend"), "semanticTokens"),
        "colors",
      ),
      "foreground",
    ),
    "value",
  );
  const reference = at(
    theme === "base" ? value : at(value, theme),
    "_contrastHigh",
  );
  if (typeof reference === "string") {
    return palette(reference);
  } else {
    throw new Error(`the preset has no high-contrast ${theme} foreground`);
  }
};

/** The colors below {@link READABLE} on `theme`'s background, with ratios. */
const unreadableOn = (theme: Theme): readonly string[] => {
  const ground = colorFor("background", theme);
  return PER_THEME.filter(
    (name) => contrast(colorFor(name, theme), ground) < READABLE,
  ).map(
    (name) => `${name} ${contrast(colorFor(name, theme), ground).toFixed(2)}:1`,
  );
};

/** The hex value of color `name` in `theme`. */
const colorFor = (name: string, theme: Theme): string => {
  const colors = at(
    at(at(domicilePreset, "theme"), "extend"),
    "semanticTokens",
  );
  const themed = at(at(at(at(colors, "colors"), name), "value"), theme);
  // A theme's value is an object when it has conditions of its own.
  const reference = typeof themed === "object" ? at(themed, "base") : themed;
  if (typeof reference === "string") {
    return palette(reference);
  } else {
    throw new Error(`the preset has no ${theme} ${name} to measure`);
  }
};

/** Resolves a `{colors.cyan.600}` reference to its palette hex. */
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
 * Reads `key` from an untyped object, or `undefined`.
 *
 * The preset's types describe Panda's input, not this preset's shape, so
 * indexing them directly does not type-check.
 */
const at = (source: unknown, key: string): unknown =>
  typeof source === "object" && source !== null && key in source
    ? Reflect.get(source, key)
    : undefined;

/** WCAG contrast ratio, from 1 (same color) to 21 (black on white). */
const contrast = (one: string, other: string): number => {
  const [brighter, darker] = [luminance(one), luminance(other)].sort(
    (first, second) => second - first,
  );
  return ((brighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

/** WCAG relative luminance of a `#rrggbb` color. */
const luminance = (hex: string): number => {
  const [red, green, blue] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.039_28
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};
