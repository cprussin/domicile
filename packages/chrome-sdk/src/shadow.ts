// Reading a `box-shadow` off a computed style.
//
// The compositor draws app windows itself, so a shadow on an `<app>` element is
// no longer something the engine puts behind a picture of the window — it has to
// be told the numbers and draw one. This turns what `getComputedStyle` reports
// into those numbers.
//
// `getComputedStyle` normalises whatever the author wrote: the colour comes
// first and every length is in `px`. So this parses the normalised forms rather
// than the whole grammar of the shorthand.
//
// The colour is the part that is not just `rgb()`. This repo's own design
// system writes every token through `color-mix(in oklab, ...)`, which computes
// to `oklab()` — so a shadow using a token would go unread by an `rgb()`-only
// parser, which is the common case here rather than the exotic one.

/** A shadow, in the logical pixels the placement is reported in. */
export type Shadow = {
  /** How far right and down the shadow sits from the window. */
  dx: number;
  dy: number;
  /** The width of the falloff. Zero is a hard edge. */
  blur: number;
  /** How much bigger than the window the shadow is before it blurs. */
  spread: number;
  /** Straight RGBA, 0-255 for the channels and 0-1 for alpha. */
  color: readonly [r: number, g: number, b: number, a: number];
};

/**
 * A computed `box-shadow` as its separate shadows, front to back.
 *
 * Empty for an element that casts none. Splitting on every comma would also
 * split `rgba(0, 0, 0, 0.5)`, so the split is on commas outside brackets —
 * which is the one definition of "how many shadows is this" in the SDK.
 * Anything counting them and anything reading them must agree, or a report
 * names a different shadow than the one that was dropped.
 */
export const splitShadows = (computed: string): string[] => {
  const trimmed = computed.trim();
  return trimmed === "" || trimmed === "none"
    ? []
    : trimmed.split(/,(?![^(]*\))/).map((shadow) => shadow.trim());
};

const RGB = /^rgba?\(([^)]*)\)/;
const OKLAB = /^oklab\(([^)]*)\)/;
const OKLCH = /^oklch\(([^)]*)\)/;
const LENGTHS = /(-?[\d.]+)px/g;

/** Why a computed `box-shadow` produced no shadow, or that it produced one. */
export enum ShadowKind {
  /** The element asked for no shadow. */
  None,
  /** An `inset` shadow: read, understood, and deliberately not drawn. */
  Inset,
  /** Asked for a shadow in a syntax this cannot read. A bug worth hearing. */
  Unreadable,
  /** Here it is. */
  Cast,
}

export const ShadowReading = {
  Cast: (shadow: Shadow) => ({ kind: ShadowKind.Cast as const, shadow }),
  Inset: () => ({ kind: ShadowKind.Inset as const }),
  None: () => ({ kind: ShadowKind.None as const }),
  Unreadable: () => ({ kind: ShadowKind.Unreadable as const }),
};

export type ShadowReading = ReturnType<
  (typeof ShadowReading)[keyof typeof ShadowReading]
>;

/**
 * Read the first shadow in a computed `box-shadow`.
 *
 * Three "no"s, kept apart, because they are not the same news: an element that
 * asked for nothing is normal, an `inset` one is declined on purpose, and one
 * whose syntax this cannot read is a bug someone should hear about. Collapsing
 * them into a single absent value is what made an `inset` shadow report itself
 * as unreadable.
 *
 * Nothing is guessed. These numbers go straight into a shader, and a
 * half-understood shadow is a smear across the desktop.
 */
export const parseShadow = (computed: string): ShadowReading => {
  // CSS layers several front to back, so the first is the one on top.
  const [first] = splitShadows(computed);
  if (first === undefined) {
    return ShadowReading.None();
  }
  // An inset shadow is drawn *inside* the box, over the client's own pixels.
  // Drawing it as an outer one would put a dark ring around a window that asked
  // for the opposite.
  if (first.includes("inset")) {
    return ShadowReading.Inset();
  }

  const color = readColor(first);
  if (color === undefined) {
    return ShadowReading.Unreadable();
  }
  const lengths = [...first.matchAll(LENGTHS)].map((match) => Number(match[1]));
  // Offset and blur are required; spread is what the shorthand may leave out.
  const [dx, dy, blur, spread = 0] = lengths;
  if (dx === undefined || dy === undefined || blur === undefined) {
    return ShadowReading.Unreadable();
  }
  if (!lengths.every((length) => Number.isFinite(length))) {
    return ShadowReading.Unreadable();
  }
  // A blur cannot be negative, and neither can a shadow drawn from one. A
  // spread can: it shrinks the shadow instead.
  if (blur < 0) {
    return ShadowReading.Unreadable();
  }
  return ShadowReading.Cast({ blur, color, dx, dy, spread });
};

const readColor = (shadow: string): Shadow["color"] | undefined => {
  const rgb = RGB.exec(shadow)?.[1];
  if (rgb !== undefined) {
    return fromRgb(rgb);
  }
  const oklab = OKLAB.exec(shadow)?.[1];
  if (oklab !== undefined) {
    return fromOklab(oklab);
  }
  const oklch = OKLCH.exec(shadow)?.[1];
  if (oklch !== undefined) {
    return fromOklch(oklch);
  }
  return undefined;
};

const fromRgb = (channels: string): Shadow["color"] | undefined => {
  const parts = channels.split(",").map((channel) => Number(channel.trim()));
  if (!parts.every(Number.isFinite)) {
    return undefined;
  }
  const [r, g, b, a = 1] = parts;
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }
  return [r, g, b, a];
};

/**
 * `oklab(L a b / alpha)`, as `color-mix(in oklab, ...)` computes to.
 *
 * The components are space-separated with an optional `/ alpha`, and `L` may be
 * written as a percentage of 1.
 */
const fromOklab = (components: string): Shadow["color"] | undefined => {
  const parsed = readComponents(components);
  if (parsed === undefined) {
    return undefined;
  }
  const [lightness, a, b, alpha] = parsed;
  return [...oklabToRgb(lightness, a, b), alpha];
};

/** `oklch(L C H / alpha)` — the same space in polar form. */
const fromOklch = (components: string): Shadow["color"] | undefined => {
  const parsed = readComponents(components);
  if (parsed === undefined) {
    return undefined;
  }
  const [lightness, chroma, hue, alpha] = parsed;
  const radians = (hue * Math.PI) / 180;
  return [
    ...oklabToRgb(
      lightness,
      chroma * Math.cos(radians),
      chroma * Math.sin(radians),
    ),
    alpha,
  ];
};

/**
 * `L x y` with an optional `/ alpha`, all as plain numbers.
 *
 * A computed value is always plain numbers or the `none` keyword. Percentages
 * are resolved away before serialising — and a percentage does not mean the
 * same thing on each component (100% is 1 on lightness and alpha but 0.4 on
 * `a`, `b` and chroma), so reading one on the way past would be a 2.5x error in
 * colour rather than a near miss.
 *
 * `none` does survive, including out of `color-mix(in oklch, ...)` when both
 * sides are missing the same component. It is declined rather than read as
 * zero: a missing component is not the same fact as a zero one, and the author
 * gets a report and no shadow instead of a colour nobody asked for.
 */
const readComponents = (
  components: string,
): [number, number, number, number] | undefined => {
  const [values, alphaText] = components.split("/");
  if (values === undefined) {
    return undefined;
  }
  const parts = values.trim().split(/\s+/);
  const [lightness, second, third] = parts.map(readNumber);
  const alpha = alphaText === undefined ? 1 : readNumber(alphaText.trim());
  if (
    lightness === undefined ||
    second === undefined ||
    third === undefined ||
    alpha === undefined
  ) {
    return undefined;
  }
  // Alpha is the one component that reaches the compositor unconverted, so it
  // is the one that has to be in range when it gets there.
  return [lightness, second, third, Math.min(Math.max(alpha, 0), 1)];
};

const readNumber = (text: string): number | undefined => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : undefined;
};

/**
 * Oklab to straight sRGB, 0-255 per channel.
 *
 * The conversion Björn Ottosson defines: cube the LMS values the matrix
 * produces, take them to linear sRGB, then apply the transfer function.
 * Out-of-gamut results are clamped, which is what a display does with them
 * anyway.
 */
const oklabToRgb = (
  lightness: number,
  a: number,
  b: number,
): [number, number, number] => {
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    channel(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    channel(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    channel(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  ];
};

const channel = (linear: number): number => {
  const clamped = Math.min(Math.max(linear, 0), 1);
  const encoded =
    clamped <= 0.003_130_8
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};
