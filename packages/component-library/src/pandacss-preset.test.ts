import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
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

  it("keeps a panel over the wallpaper dark in either theme", () => {
    // The panel is dark whatever the theme, so what is drawn on it takes the
    // dark theme's colors. Mixed colors are declared again so they mix the
    // panel's colors, not the page's.
    expect(withoutPanelColors()).toStrictEqual([]);
  });

  it("draws faint text legibly on a panel over a white page or wallpaper, in either theme", () => {
    expect(faintOverWhite("_light")).toBeGreaterThanOrEqual(READABLE);
    expect(faintOverWhite("base")).toBeGreaterThanOrEqual(READABLE);
  });

  it("draws muted text legibly on a tile on a card, in either theme", () => {
    expect(mutedOnTile("_light")).toBeGreaterThanOrEqual(READABLE);
    expect(mutedOnTile("base")).toBeGreaterThanOrEqual(READABLE);
  });

  it("holds the theme wipe at its start while windows turn", () => {
    // `flipThemeWithAnimation` sets `data-theme-holding` until the windows
    // have repainted behind the old frame.
    expect(
      at(
        at(domicilePreset, "globalCss"),
        "html[data-theme-flip-to][data-theme-holding]::view-transition-new(root)",
      ),
    ).toStrictEqual({ animationPlayState: "paused" });
  });

  it("lands a staggered change at once under reduced motion", () => {
    const reduced = at(
      at(domicilePreset, "globalCss"),
      "[data-reduced-motion] *, [data-reduced-motion] *::before, [data-reduced-motion] *::after",
    );
    expect(at(reduced, "transitionDelay")).toBe("0s !important");
    expect(at(reduced, "animationDelay")).toBe("0s !important");
  });

  it("leaves the shell handover's crossfade to the browser", () => {
    // `load_shell`'s view transition fades the splash into the shell. The
    // wipe's rules would hold the splash opaque under an additive fade-in,
    // which saturates to white.
    const globalCss = at(domicilePreset, "globalCss");
    expect(at(globalCss, "::view-transition-old(root)")).toBeUndefined();
    expect(at(globalCss, "::view-transition-new(root)")).toBeUndefined();
    expect(
      at(globalCss, "html[data-theme-flip-to]::view-transition-old(root)"),
    ).toStrictEqual({ animationName: "none" });
  });

  it("draws an outline only where focus can show it", () => {
    // Blink repaints an element with an outline whenever it moves, even a
    // transparent one, so a dragged window would repaint every frame.
    const everything = at(at(at(domicilePreset, "globalCss"), "html"), "*");
    expect(at(everything, "outlineStyle")).toStrictEqual({
      _focusVisible: "solid",
      base: "none",
    });
  });

  it("sets the page's color scheme from the theme", () => {
    const html = at(at(domicilePreset, "globalCss"), "html");
    expect(at(html, "colorScheme")).toBe("dark");
    expect(at(html, "&[data-theme=light]")).toStrictEqual({
      colorScheme: "light",
    });
  });

  it("keeps every package's global styles from replacing its own", async () => {
    // Panda merges `globalCss` one selector deep, so a package's `html` rule
    // drops the preset's, and with it the rule that hides outlines.
    const own = selectors(domicilePreset);
    const packages = join(dirname(import.meta.dir), "..");
    const clashes: string[] = [];
    for await (const path of new Bun.Glob("*/panda.config.ts").scan(packages)) {
      const config: unknown = (await import(join(packages, path))).default;
      clashes.push(
        ...selectors(config)
          .filter((selector) => own.includes(selector))
          .map((selector) => `${path}: ${selector}`),
      );
    }
    expect(clashes).toStrictEqual([]);
  });

  it("lifts only an enabled element that is not picked on hover", () => {
    const hover = at(
      at(at(domicilePreset, "conditions"), "extend"),
      "hoverEnabled",
    );
    if (typeof hover !== "string") {
      throw new Error("no hoverEnabled condition");
    }
    // happy-dom matches no `:hover`, so the test asks what else must hold.
    const lifts = (html: string) => {
      const parent = document.createElement("div");
      parent.innerHTML = html;
      const element = parent.firstElementChild;
      if (element === null) {
        throw new Error(`no element in ${html}`);
      }
      return element.matches(hover.replace("&:hover", "*"));
    };

    expect(lifts("<button></button>")).toBe(true);
    expect(lifts('<button aria-selected="false"></button>')).toBe(true);
    expect(lifts("<button disabled></button>")).toBe(false);
    expect(lifts('<button aria-current="page"></button>')).toBe(false);
    expect(lifts('<button aria-selected="true"></button>')).toBe(false);
    expect(lifts("<button data-checked></button>")).toBe(false);
  });

  it("keeps a button lit while the popup it opened is open", () => {
    const lit = at(
      at(at(domicilePreset, "conditions"), "extend"),
      "hoverOrOpen",
    );
    if (typeof lit !== "string") {
      throw new Error("no hoverOrOpen condition");
    }
    // happy-dom matches no `:hover`, so the test asks only about the popup.
    const lights = (html: string) => {
      const parent = document.createElement("div");
      parent.innerHTML = html;
      const element = parent.firstElementChild;
      if (element === null) {
        throw new Error(`no element in ${html}`);
      }
      return element.matches(lit.replace("&", "*").replace(":hover, ", ""));
    };

    expect(lights("<button data-popup-open></button>")).toBe(true);
    expect(lights("<button></button>")).toBe(false);
  });

  it("keeps a control's outline, so its focus ring fades out", () => {
    // `control` transitions `outline-color`; with no outline, the ring would
    // vanish at once on blur.
    const control = at(
      at(at(at(domicilePreset, "theme"), "extend"), "recipes"),
      "control",
    );
    expect(at(at(control, "base"), "outlineStyle")).toBe("solid");
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

/** The selectors `config`'s `globalCss` styles. */
const selectors = (config: unknown): readonly string[] => {
  const globalCss = at(config, "globalCss");
  return typeof globalCss === "object" && globalCss !== null
    ? Object.keys(globalCss)
    : [];
};

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

/**
 * The contrast of `muted` on the faintest surface text sits on: a tile of
 * `foreground` at 6% on a `card`, as the notification drawer draws its
 * notifications.
 */
const mutedOnTile = (theme: Theme): number => {
  const foreground = colorFor("foreground", theme);
  const background = colorFor("background", theme);
  const card = mixed(foreground, 0.06, background);
  return contrast(
    mixed(foreground, mutedShare(), background),
    mixed(foreground, 0.06, card),
  );
};

/**
 * The color tokens a panel over the wallpaper doesn't redeclare as the dark
 * theme's: each per-theme color takes its dark value, and each mix its own.
 */
const withoutPanelColors = (): readonly string[] => {
  const colors = at(
    at(at(at(domicilePreset, "theme"), "extend"), "semanticTokens"),
    "colors",
  );
  const names =
    typeof colors === "object" && colors !== null ? Object.keys(colors) : [];
  return names.filter((name) => {
    const value = at(at(colors, name), "value");
    const dark = typeof value === "string" ? value : at(value, "base");
    const mixes = typeof dark === "string" && dark.includes("{colors.");
    return mixes && at(value, "_onPhoto") !== dark;
  });
};

/**
 * The contrast of `textFaint` on a panel in `theme` over the brightest thing
 * behind it: a white page or wallpaper.
 */
const faintOverWhite = (theme: Theme): number => {
  const panel = over("#000000", opacityOf("panelOverPhoto", theme), "#ffffff");
  return contrast(over("#ffffff", shareOf("textFaint"), panel), panel);
};

/** A token's colors. */
const tokenColors = (): unknown =>
  at(at(at(at(domicilePreset, "theme"), "extend"), "semanticTokens"), "colors");

/** The opacity of an `rgb(from black r g b / N%)` token in `theme`, 0 to 1. */
const opacityOf = (name: string, theme: Theme): number => {
  const value = at(at(tokenColors(), name), "value");
  const themed = typeof value === "string" ? value : at(value, theme);
  const percent =
    typeof themed === "string"
      ? /\/ (?<percent>\d+)%\)$/u.exec(themed)?.groups?.percent
      : undefined;
  if (percent === undefined) {
    throw new Error(`the preset has no ${theme} opacity for ${name}`);
  } else {
    return Number(percent) / 100;
  }
};

/** How much `currentcolor` a `currentcolor` token keeps, 0 to 1. */
const shareOf = (name: string): number => {
  const value = at(at(tokenColors(), name), "value");
  const percent =
    typeof value === "string"
      ? /currentcolor (?<percent>\d+)%/u.exec(value)?.groups?.percent
      : undefined;
  if (percent === undefined) {
    throw new Error(`the preset has no currentcolor share for ${name}`);
  } else {
    return Number(percent) / 100;
  }
};

/** `color` at `opacity` over `ground`, as the browser composites it. */
const over = (color: string, opacity: number, ground: string): string =>
  `#${[1, 3, 5]
    .map((start) => {
      const top = Number.parseInt(color.slice(start, start + 2), 16);
      const bottom = Number.parseInt(ground.slice(start, start + 2), 16);
      return Math.round(top * opacity + bottom * (1 - opacity))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;

/** How much `foreground` `muted` mixes into `background`, from 0 to 1. */
const mutedShare = (): number => {
  const value = at(
    at(
      at(
        at(at(at(domicilePreset, "theme"), "extend"), "semanticTokens"),
        "colors",
      ),
      "muted",
    ),
    "value",
  );
  const share =
    /\{colors\.foreground\} (?<percent>\d+)%, \{colors\.background\}/u.exec(
      String(at(value, "base")),
    )?.groups?.percent;
  if (share === undefined) {
    throw new Error("muted is not a mix of foreground into background");
  } else {
    return Number(share) / 100;
  }
};

/** `share` of `one` mixed into `other` in oklab, as `color-mix` does. */
const mixed = (one: string, share: number, other: string): string => {
  const [first, second] = [oklab(one), oklab(other)];
  return hexOf(
    first.map(
      (channel, index) => channel * share + (second[index] ?? 0) * (1 - share),
    ),
  );
};

/** The oklab `[L, a, b]` of a `#rrggbb` color. */
const oklab = (hex: string): number[] => {
  const [red = 0, green = 0, blue = 0] = linear(hex);
  const [long, medium, short] = [
    0.412_221_470_8 * red + 0.536_332_536_3 * green + 0.051_445_992_9 * blue,
    0.211_903_498_2 * red + 0.680_699_545_1 * green + 0.107_396_956_6 * blue,
    0.088_302_461_9 * red + 0.281_718_837_6 * green + 0.629_978_700_5 * blue,
  ].map(Math.cbrt) as [number, number, number];
  return [
    0.210_454_255_3 * long + 0.793_617_785 * medium - 0.004_072_046_8 * short,
    1.977_998_495_1 * long - 2.428_592_205 * medium + 0.450_593_709_9 * short,
    0.025_904_037_1 * long + 0.782_771_766_2 * medium - 0.808_675_766 * short,
  ];
};

/** The `#rrggbb` of an oklab `[L, a, b]`. */
const hexOf = ([lightness = 0, greenRed = 0, blueYellow = 0]: number[]) => {
  const [long, medium, short] = [
    lightness + 0.396_337_777_4 * greenRed + 0.215_803_757_3 * blueYellow,
    lightness - 0.105_561_345_8 * greenRed - 0.063_854_172_8 * blueYellow,
    lightness - 0.089_484_177_5 * greenRed - 1.291_485_548 * blueYellow,
  ].map((channel) => channel ** 3) as [number, number, number];
  return `#${[
    4.076_741_662_1 * long - 3.307_711_591_3 * medium + 0.230_969_929_2 * short,
    -1.268_438_004_6 * long +
      2.609_757_401_1 * medium -
      0.341_319_396_5 * short,
    -0.004_196_086_3 * long - 0.703_418_614_7 * medium + 1.707_614_701 * short,
  ]
    .map((channel) => {
      const clamped = Math.min(1, Math.max(0, channel));
      const encoded =
        clamped <= 0.003_130_8
          ? clamped * 12.92
          : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
};

/** The linear-light channels of a `#rrggbb` color, from 0 to 1. */
const linear = (hex: string): number[] =>
  [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.039_28
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

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
  const [red, green, blue] = linear(hex);
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};
