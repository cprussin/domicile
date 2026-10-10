// Generated from `config.schema.json` by `codegen/generate-config.ts`. Do not
// edit. Change `packages/domicile-config` and run `bun run generate` in
// `packages/chrome-sdk`.
//
// The config's sections, for a TypeScript config module's exports:
//
//   import type { OutputConfig } from "@domicile-desktop/sdk/config";
//   export const output: OutputConfig = { max_scale: 1 };
//
// See `docs/SHELL-CONFIG.md`.

/** The full compositor configuration. */
export type Config = {
  /** Where editors find this file's JSON Schema. Domicile ignores it. */
  $schema?: string | null;
  extensions?: ExtensionsConfig;
  files?: FilesConfig;
  idle?: IdleConfig;
  input?: InputConfig;
  lock?: LockConfig;
  lockdown?: LockdownConfig;
  output?: OutputConfig;
  /**
   * The shell `domicile` runs when given none: a path or a package, as
   * `domicile load-shell` takes. The compositor ignores it.
   */
  shell?: string | null;
  startup?: StartupConfig;
  theme?: ThemeConfig;
};

/** An sRGB color, written `"#rrggbb"`. */
export type AccentColor = string;

/** How strongly clients set text and edges apart from their background. */
export type Contrast = "normal" | "high";

/**
 * One display, described in the config rather than discovered.
 *
 * A nested compositor has no monitors to enumerate. Each display becomes a
 * `wl_output` and a region of the chrome page, which the shell addresses by
 * `name`. `position` and `size` are logical units.
 */
export type DisplayConfig = {
  /**
   * The name the chrome and the compositor use for this display.
   *
   * Matched exactly, so a name padded with whitespace is rejected.
   */
  name: string;
  /**
   * The top-left corner in the config's coordinate space.
   *
   * May be negative.
   */
  position?: [number, number];
  /**
   * The `wl_output` scale for clients on this display.
   *
   * `output.max_scale` does not apply to described displays.
   */
  scale?: number;
  /**
   * Width and height in logical units. The `wl_output` mode is this times
   * `scale`.
   */
  size: [number, number];
};

/**
 * One display of a profile: which monitor, and what to do with it.
 *
 * Every field but `display` defaults to leaving the monitor as it is.
 */
export type DisplayPlacement = {
  /**
   * The connected display this entry places, matched by exact name.
   *
   * On a tty the output name is `drm-<id>`. Ozone derives the id from the
   * EDID, so it survives a replug. A panel name also matches.
   */
  display: string;
  /**
   * Whether the display is part of the desktop.
   *
   * A disabled display must still be connected for the profile to match.
   * This lets a profile match a docked laptop and keep windows off its
   * closed lid.
   */
  enabled?: boolean;
  /**
   * The mode, in physical pixels, this entry's placement assumes. Absent
   * means any mode.
   *
   * A check, not a request: the engine holds DRM master and sets each
   * connector's native mode, so the compositor cannot modeset. Positions
   * often depend on other displays' sizes, so a different mode makes the
   * profile wrong, and applying it fails.
   *
   * No refresh rate: it does not affect layout, cannot be chosen, and some
   * monitors report none.
   */
  mode?: [number, number] | null;
  /**
   * The top-left corner in the profile's coordinate space.
   *
   * May be negative.
   */
  position?: [number, number];
  /**
   * Device pixels per logical pixel.
   *
   * Fractional, because real scales are: 1.5 on a 2880x1920 panel gives a
   * 1920x1280 desktop. This differs from the integer `wl_output.scale`; the
   * compositor's `Screens` advertises that, and `xdg_output` carries the
   * logical size.
   */
  scale?: number;
  /** Which way up the monitor is. */
  transform?: Transform;
};

/**
 * Chrome extensions the engine installs into the browser windows' profile.
 * See `docs/architecture/EXTENSIONS.md`.
 *
 * Listing an extension is consent: there is no install prompt. Removing one
 * from the list uninstalls it.
 */
export type ExtensionsConfig = {
  /** Directories holding an unpacked extension, loaded as they are. */
  unpacked?: string[];
  /** Chrome Web Store ids, installed from the Store and updated from it. */
  web_store?: string[];
};

/** What the file index is built from. */
export type FilesConfig = {
  omit?: FilesOmit;
};

/**
 * The paths the file index leaves out, and everything under them.
 *
 * Patterns follow gitignore's rules:
 * - Each is a glob over a path relative to the home. `*` stops at `/`; `**`
 *   does not.
 * - A pattern starting with `!` takes a path back.
 * - The last matching pattern wins.
 * - An omitted directory is not walked, so nothing under it can be taken
 *   back.
 *
 * The default is `**\/.*`, which omits hidden paths. A configured list
 * replaces the default.
 */
export type FilesOmit = string[];

/**
 * When an idle desktop turns its screens off.
 *
 * Absent means never, and that is the default: a blank screen looks like a
 * crash, so a shell must opt in. When `lock` sets a verifier,
 * blanking also locks the desk. See `docs/IDLE.md`.
 *
 * The unit is in the key name because a generator writes this file.
 */
export type IdleConfig = {
  /**
   * Seconds without input before the screens go dark.
   *
   * Absent means never. Zero is refused.
   */
  blank_after_seconds?: number | null;
};

/** Input-device settings. */
export type InputConfig = {
  keyboard?: KeyboardConfig;
};

/**
 * Keyboard settings, named after SwayWM's `xkb_*` options.
 *
 * The string fields go to xkb verbatim, so sway's multi-layout form
 * (`xkb_layout = "us,de"`) works. Empty `xkb_rules` and `xkb_model` use the
 * libxkbcommon defaults. The default layout is `us`.
 */
export type KeyboardConfig = {
  xkb_layout?: string;
  xkb_model?: string;
  xkb_options?: string[];
  xkb_rules?: string;
  xkb_variant?: string;
};

/**
 * What unlocks this desk.
 *
 * Absent means the desk never locks, and that is the default: a locked desk
 * with no verifier cannot be unlocked. Such a desk never sends
 * `HostMessage::Locked`.
 *
 * Set one verifier:
 * - `pam_service` authenticates the desk's user against a PAM service.
 * - `passphrase` is for machines without a PAM service. The file is
 *   generated, often into the world-readable Nix store, so any user can read
 *   it.
 *
 * A config with both is refused, so a passphrase is never mistaken for a PAM
 * fallback. A PAM service that does not exist stops the compositor from
 * starting. See `docs/LOCK.md#verifiers`.
 */
export type LockConfig = {
  /**
   * The PAM service the desk's user authenticates against.
   *
   * The system must declare it in `/etc/pam.d/`; on NixOS,
   * `security.pam.services.<name> = {};`. The docs use `"domicile"`.
   */
  pam_service?: string | null;
  /** A passphrase that unlocks this desk. An empty string is refused. */
  passphrase?: string | null;
};

/**
 * What applications are told not to do, through the
 * `org.freedesktop.impl.portal.Lockdown` portal. Every switch defaults to
 * off.
 *
 * Applications enforce these themselves; the compositor only reports them.
 * See `docs/SHELL-CONFIG.md#lockdown`.
 */
export type LockdownConfig = {
  disable_application_handlers?: boolean;
  disable_camera?: boolean;
  disable_location?: boolean;
  disable_microphone?: boolean;
  disable_printing?: boolean;
  disable_save_to_disk?: boolean;
  disable_sound_output?: boolean;
};

/** Output settings. */
export type OutputConfig = {
  /**
   * The displays that make up the desktop.
   *
   * Empty means one output sized to Domicile's own window.
   */
  displays?: DisplayConfig[];
  /**
   * The highest `wl_output` scale to advertise.
   *
   * Limits cost: a client at scale N renders N² times the pixels. `1` turns
   * scaling off. Applies only while `displays` is empty.
   */
  max_scale?: number;
  /**
   * Placements for real monitors, matched against what is connected.
   *
   * Re-read on every hotplug. Empty leaves the monitors where the engine
   * placed them. See `docs/DISPLAYS.md#profiles`.
   */
  profiles?: Profile[];
};

/**
 * One arrangement of monitors, and where each goes.
 *
 * Applies when the displays it names are exactly the connected ones.
 */
export type Profile = {
  /** Every display this arrangement is for, including the ones it turns off. */
  displays: DisplayPlacement[];
  /**
   * The profile's name, unique in the config. The log prints it when the
   * profile applies.
   */
  name: string;
};

/**
 * The commands a desk starts with.
 *
 * Run once, when the compositor starts. A reload does not rerun them, which
 * would start duplicates, or stop them, which would kill programs in use.
 */
export type StartupConfig = {
  /**
   * Each an argv, run without a shell. For shell syntax, use
   * `["sh", "-c", "…"]`.
   */
  commands?: string[][];
};

/**
 * How the desktop is themed.
 *
 * Clients read every field but `mode` through the settings portal; see the
 * compositor's `portals::settings`.
 */
export type ThemeConfig = {
  /** The color clients highlight with, or their own when unset. */
  accent_color?: AccentColor | null;
  contrast?: Contrast;
  /**
   * The freedesktop icon theme's directory name, such as `Papirus-Dark`.
   * Unset leaves shells with `hicolor`.
   */
  icon_theme?: string | null;
  mode?: ThemeMode;
  /** Asks clients to keep animation to a minimum. */
  reduced_motion?: boolean;
};

/**
 * Whether the desktop is drawn dark or light.
 *
 * There is no "follow the system" option: the chrome is the system, so there
 * is nothing to follow. Clients follow this value through the settings
 * portal; see the compositor's `portals::settings`.
 */
export type ThemeMode = "dark" | "light";

/**
 * Which way up a monitor is, named for the matching `wl_output.transform`.
 *
 * Rotations only; nothing needs flips.
 */
export type Transform = "normal" | "rotate-90" | "rotate-180" | "rotate-270";
