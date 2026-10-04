import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { ThemeMessage } from "@domicile-desktop/sdk/host-message";

import { rememberedTheme, rememberTheme } from "./remembered-theme";

/**
 * How long to wait for sites in browser windows to repaint after the engine
 * learns the windows' theme. They repaint within a frame or two, but nothing
 * reports when.
 */
const SITES_REPAINT_WITHIN_MS = 100;

/**
 * Adapts the host's theme to the component library's theme source, as
 * `host-displays.ts` does for displays.
 *
 * `setTheme` requests the change and does not apply it. The compositor applies
 * it to every chrome and to the settings portal that GTK, Qt and Electron
 * clients read, so the shell and the windows change together.
 *
 * Build once per client, not per render: `DomicileClient.on` is a single slot
 * and `ThemeProvider` re-registers whenever the source's identity changes.
 */
export const hostTheme = (domicile: DomicileClient): ThemeSource => {
  const turning: (() => void)[] = [];
  // Registered up front because the client replays the handshake's windows'
  // theme to the first handler; registering later would mistake that replay for
  // an answer. Any answer settles every waiting wipe, since only the newest
  // request is answered.
  domicile.on("windows_theme", () => {
    for (const settle of turning.splice(0)) {
      // Sites in browser windows are drawn by this engine, which receives the
      // same message and repaints them a frame or two later.
      setTimeout(settle, SITES_REPAINT_WITHIN_MS);
    }
  });
  return {
    onTheme: (handler) => {
      // Keep the wrapped handler, because `off` only removes the handler if it
      // is still the registered one (as in `hostDisplays`).
      //
      // The theme is remembered here because this is the only place it arrives:
      // `on` is one slot per message type, so a second `theme` registration
      // would replace the provider's.
      const registered = ({ theme }: ThemeMessage) => {
        rememberTheme(theme);
        handler(theme);
      };
      domicile.on("theme", registered);
      return () => {
        domicile.off("theme", registered);
      };
    },
    setTheme: (theme) => {
      domicile.setTheme(theme);
    },
    /**
     * The remembered guess; see `remembered-theme.ts`. The theme is a message,
     * not a host attribute, so there is nothing to read synchronously. The real
     * theme arrives through `onTheme` just after the provider's first effect,
     * and the page paints with this until then.
     */
    get theme() {
      return rememberedTheme();
    },
    turnWindows: (theme) =>
      new Promise((resolve) => {
        turning.push(resolve);
        domicile.themeCaptured(theme);
      }),
  };
};
