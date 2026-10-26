// The config's icon theme, followed once per desktop and shared by the
// launcher and tray menus.

import { perDesktop } from "@domicile-desktop/react/per-desktop";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { IconThemeDesktop } from "@domicile-desktop/sdk/icon-theme";
import { watchIconTheme } from "@domicile-desktop/sdk/icon-theme";

/** The icon theme as last read, or `undefined` for `hicolor` only. */
export type IconTheme = () => Promise<string | undefined>;

/** {@link followIconTheme} for `domicile`, started on first use. */
export const sharedIconTheme: (domicile: Domicile) => IconTheme = perDesktop(
  (domicile) => followIconTheme(domicile),
);

/**
 * Follows the icon theme from now on. Answers once the first read settles.
 *
 * A theme that cannot be read is logged and answered as `hicolor`: missing
 * icons are cosmetic, and a launcher or menu should still open.
 */
export const followIconTheme = (
  host: IconThemeDesktop,
  watch: typeof watchIconTheme = watchIconTheme,
): IconTheme => {
  const first = Promise.withResolvers<string | undefined>();
  const state = { latest: first.promise };
  watch(host, (read) => {
    const theme = read.match({
      Err: (error) => {
        // biome-ignore lint/suspicious/noConsole: icons fall back to hicolor; say why
        console.error(
          "Could not read the icon theme; drawing hicolor icons",
          error,
        );
        return undefined;
      },
      Ok: (found) =>
        found.match({ None: () => undefined, Some: (name) => name }),
    });
    first.resolve(theme);
    state.latest = Promise.resolve(theme);
  });
  return () => state.latest;
};
