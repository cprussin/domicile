import type { Theme } from "@domicile-desktop/component-library/theme-core";
import type { ThemeSource } from "@domicile-desktop/component-library/theme-source";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import { watchHost } from "../host/watch-host";
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
 * no protocol dependency and the host has no idea what a provider is, so the
 * shell — which has both — is where they meet.
 *
 * **`setTheme` asks and does not apply**, which is the shape of the whole
 * feature. The compositor is what answers, to every chrome on the desk rather
 * than to the one that clicked, and it is also what hands the same value to the
 * settings portal the desk's GTK, Qt and Electron clients read their color
 * scheme from. A shell that painted itself on the click would be the one
 * monitor that had changed, on a desk whose windows had not.
 *
 * Built once per host and not per render, because a source is the connection.
 */
export const hostTheme = (domicile: DomicileHost): ThemeSource => {
  const turning: (() => void)[] = [];
  // Listened for now rather than when a wipe asks, so that any answer settles
  // every wipe waiting: a newer turnover replaces an older one and only the
  // newer is answered.
  domicile.addEventListener("windowsthemechanged", () => {
    for (const settle of turning.splice(0)) {
      // The sites in browser windows are drawn by this engine, which is told
      // with the same message and repaints them a frame or two later.
      setTimeout(settle, SITES_REPAINT_WITHIN_MS);
    }
  });
  return {
    // This is the one place the desk's theme arrives, which is why the
    // remembering is here rather than beside the entry point's pre-paint apply.
    onTheme: (handler) =>
      watchHost(domicile, "themechanged", themeOf, (theme) => {
        rememberTheme(theme);
        handler(theme);
      }),
    setTheme: (theme) => {
      domicile.setTheme(theme);
    },
    /**
     * The desk's theme, once it has said one; until then the guess — see
     * `remembered-theme.ts` — which is what the page paints in meanwhile.
     */
    get theme() {
      return themeOf(domicile) ?? rememberedTheme();
    },
    turnWindows: (theme) =>
      new Promise((resolve) => {
        turning.push(resolve);
        domicile.themeCaptured(theme);
      }),
  };
};

const themeOf = ({ theme }: DomicileHost): Theme | undefined =>
  theme ?? undefined;
