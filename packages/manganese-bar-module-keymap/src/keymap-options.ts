import { createContext } from "react";

/** How the keymap item shows. */
export type KeymapOptions = {
  /** Whether it shows nothing while the first keymap, the default, is active. */
  readonly hideDefault: boolean;
};

/** Shown on every keymap. */
export const KEYMAP_DEFAULTS: KeymapOptions = { hideDefault: false };

/**
 * How every `<Keymap />` under it shows. manganese provides the shell's
 * `keymap` options here.
 */
export const KeymapOptionsContext =
  createContext<KeymapOptions>(KEYMAP_DEFAULTS);
