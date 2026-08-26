// What a shell tells the compositor about the desktop it wants.
//
// The shell owns the configuration a *person* writes — its own file, its own
// schema, its own name for everything — and generates this from it. So this is
// not a user interface: it is the part of a shell's own settings that the
// compositor is the one to act on, in the shape the compositor reads.

/** How a key press is turned into a keysym, named after the `xkb_*` options. */
export type KeyboardConfig = {
  rules?: string | undefined;
  model?: string | undefined;
  layout?: string | undefined;
  variant?: string | undefined;
  /** `caps:swapescape`, `compose:ralt`, and the rest. */
  options?: readonly string[] | undefined;
};

/** One display, described rather than discovered: a nested compositor has none. */
export type DisplayConfig = {
  /** How the shell and the compositor name this display to each other. */
  name: string;
  /** Its top-left corner, in whatever space the shell lays displays out in. */
  position?: readonly [number, number] | undefined;
  /** The `wl_output` scale advertised to clients on it. */
  scale?: number | undefined;
  /** Width and height, in logical units. */
  size: readonly [number, number];
};

/** Everything a shell can say about the compositor it is running. */
export type CompositorConfig = {
  /** The desktop's size when no displays are described. */
  nestedSize?: readonly [number, number] | undefined;
  /** The highest `wl_output` scale to advertise. A cost dial: N² the pixels. */
  maxScale?: number | undefined;
  keyboard?: KeyboardConfig | undefined;
  /** The displays that make up the desktop. Empty means one that follows the window. */
  displays?: readonly DisplayConfig[] | undefined;
};

/** The compositor's own config file, as a value ready to be stringified. */
export const configDocument = ({
  displays,
  keyboard,
  maxScale,
  nestedSize,
}: CompositorConfig): unknown => ({
  compositor: { nested_size: nestedSize },
  input: { keyboard: keyboardDocument(keyboard ?? {}) },
  output: { displays, max_scale: maxScale },
});

/**
 * The keyboard section, whose keys carry the `xkb_` prefix the compositor
 * hands straight to libxkbcommon.
 *
 * Stated whole, always — including for a shell that mentioned no keyboard at
 * all, which is both shipped shells on a fresh install. Every one of these
 * fields defaults on the compositor's side, and its defaults are one person's
 * layout: Programmer's Dvorak with Caps and Escape swapped. Emitting only what
 * a shell set meant saying nothing produced a keymap nobody asked for, on
 * every client of the desktop.
 *
 * `layout` is the exception, left out when unset: the compositor refuses an
 * empty one, and its default there is `us` rather than a preference. A shell
 * that named no layout is asking for whatever the compositor calls ordinary.
 */
const keyboardDocument = ({
  layout,
  model,
  options,
  rules,
  variant,
}: KeyboardConfig): unknown => ({
  xkb_layout: layout,
  xkb_model: model ?? "",
  xkb_options: options ?? [],
  xkb_rules: rules ?? "",
  xkb_variant: variant ?? "",
});
