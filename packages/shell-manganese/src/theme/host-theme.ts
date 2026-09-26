import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { ThemeMessage } from "@domicile/chrome-sdk/host-message";
import type { ThemeSource } from "@domicile/component-library/theme-source";

import { rememberedTheme, rememberTheme } from "./remembered-theme";

/**
 * How long a site in a browser window is given to repaint once the engine has
 * been told the windows' theme. Its renderer hears the change beside this
 * page, and repaints on its next frame or two; nothing reports when it has.
 */
const SITES_REPAINT_WITHIN_MS = 100;

/**
 * The desktop's theme, as the component library wants to be told about it.
 *
 * The other half of the adapter `host-displays.ts` is: the design system has
 * no protocol dependency and the control channel has no idea what a provider
 * is, so the shell — which has both — is where they meet.
 *
 * **`setTheme` asks and does not apply**, which is the shape of the whole
 * feature. The compositor is what answers, to every chrome on the desk rather
 * than to the one that clicked, and it is also what hands the same value to the
 * settings portal the desk's GTK, Qt and Electron clients read their color
 * scheme from. A shell that painted itself on the click would be the one
 * monitor that had changed, on a desk whose windows had not.
 *
 * Built once per client and not per render. `DomicileClient.on` is a single
 * slot and `ThemeProvider` re-registers whenever its source's identity changes,
 * so a source rebuilt each render would re-register each render.
 */
export const hostTheme = (domicile: DomicileClient): ThemeSource => {
  const turning: (() => void)[] = [];
  // Registered now rather than when a wipe asks, because the handshake states
  // the windows' theme too and the client replays what it holds to the first
  // handler: registered late, that replay would read as the answer to a
  // capture it came long before. Any answer settles every wipe waiting, since
  // a newer turnover replaces an older one and only the newer is answered.
  domicile.on("windows_theme", () => {
    for (const settle of turning.splice(0)) {
      // The sites in browser windows are drawn by this engine, which is told
      // with the same message and repaints them a frame or two later.
      setTimeout(settle, SITES_REPAINT_WITHIN_MS);
    }
  });
  return {
    onTheme: (handler) => {
      // Held, for `hostDisplays`'s reason: `off` is given the handler the client
      // actually registered rather than the caller's, so a teardown removes one
      // only if it is still the registered one.
      //
      // And this is the one place the desk's theme arrives, which is why the
      // remembering is here rather than beside the entry point's pre-paint
      // apply: `on` is a single slot per message type, so a second registration
      // for `theme` would displace the provider's.
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
     * The guess, not the answer — see `remembered-theme.ts`. There is no
     * `domicile.theme` to read: unlike the desktop, which is an attribute on the
     * host because a component may mount long after it was described, the theme
     * is a message, and the client replays the one it is holding to the first
     * handler that registers. So the truth arrives through `onTheme` a
     * microtask into the provider's first effect, and this is what the page
     * paints in until it does.
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
