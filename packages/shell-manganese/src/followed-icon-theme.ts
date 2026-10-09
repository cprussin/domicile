// The config's icon theme, followed once per desktop and shared by the
// launcher and tray menus.

import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { IconThemeSystem } from "@domicile-desktop/sdk/icon-theme";
import { watchIconTheme } from "@domicile-desktop/sdk/icon-theme";
import { system } from "@domicile-desktop/sdk/system";

/** The icon theme as last read, or `undefined` for `hicolor` only. */
export type IconTheme = () => Promise<string | undefined>;

const shared = new WeakMap<DomicileHost, IconTheme>();

/** {@link followIconTheme} for `domicile`, started on first use. */
export const sharedIconTheme = (domicile: DomicileHost): IconTheme => {
  const known = shared.get(domicile);
  if (known === undefined) {
    const theme = followIconTheme(system(domicile));
    shared.set(domicile, theme);
    return theme;
  } else {
    return known;
  }
};

/**
 * Follows the icon theme from now on. Answers once the first read settles.
 *
 * A theme that cannot be read is logged and answered as `hicolor`: missing
 * icons are cosmetic, and a launcher or menu should still open.
 */
export const followIconTheme = (
  host: IconThemeSystem,
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
