// The config's `theme` keys besides `mode`: the accent color, contrast and
// reduced motion the settings portal also serves applications. A shell follows
// them so the desk matches its windows. See `docs/SHELL-CONFIG.md`.

import type { Appearance } from "./desktop/appearance";
import { readAppearance } from "./desktop/appearance";
import type { DomicileHost } from "./domicile-host";

export type { Appearance } from "./desktop/appearance";

/** What `watchAppearance` needs of the desktop `Shell` is handed. */
export type AppearanceHost = Pick<
  DomicileHost,
  | "accentColor"
  | "addEventListener"
  | "highContrast"
  | "reducedMotion"
  | "removeEventListener"
>;

/**
 * Call `listener` with the appearance now and on each change. Returns a
 * function that stops listening. Throws on an accent that is not `#rrggbb`.
 */
export const watchAppearance = (
  host: AppearanceHost,
  listener: (appearance: Appearance) => void,
): (() => void) => {
  const heard = () => {
    listener(readAppearance(host));
  };
  host.addEventListener("appearancechanged", heard);
  heard();
  return () => {
    host.removeEventListener("appearancechanged", heard);
  };
};
