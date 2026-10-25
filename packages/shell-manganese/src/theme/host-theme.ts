import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { rememberedTheme, rememberTheme } from "./remembered-theme";

/**
 * How long to wait for sites in browser windows to repaint after the engine
 * learns the windows' theme. Nothing reports when they do. A busy site can take
 * well over 100ms, and one that misses this is captured in the old theme and
 * flashes at the end of the wipe.
 */
const SITES_REPAINT_WITHIN_MS = 300;

/**
 * Adapts the host's theme to the component library's theme source, as
 * `host-displays.ts` does for displays.
 *
 * `setTheme` requests the change and does not apply it. The compositor applies
 * it to every chrome and to the settings portal that GTK, Qt and Electron
 * clients read, so the shell and the windows change together.
 *
 * Build once per host, not per render: `ThemeProvider` re-registers whenever
 * the source's identity changes.
 */
export const hostTheme = ({ theme }: Pick<Domicile, "theme">): ThemeSource => {
  const turning: (() => void)[] = [];
  // Registered up front so any answer settles every waiting wipe, since only
  // the newest request is answered.
  theme.on("windowschange", () => {
    for (const settle of turning.splice(0)) {
      // Sites in browser windows are drawn by this engine, which receives the
      // same message and repaints them a frame or two later.
      setTimeout(settle, SITES_REPAINT_WITHIN_MS);
    }
  });
  return {
    // The theme is remembered here because this is the only place it arrives.
    onTheme: (handler) =>
      watchHost(
        (heard) => theme.on("change", heard),
        () => theme.current,
        (current) => {
          rememberTheme(current);
          handler(current);
        },
      ),
    setTheme: (next) => {
      theme.set(next);
    },
    /**
     * The host's theme, or the remembered guess (see `remembered-theme.ts`)
     * until the host has one. The page paints with the guess until then.
     */
    get theme() {
      return theme.current ?? rememberedTheme();
    },
    turnWindows: (next) =>
      new Promise((resolve) => {
        turning.push(resolve);
        theme.captured(next);
      }),
  };
};
