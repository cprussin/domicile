import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { ThemeMessage } from "@domicile/chrome-sdk/host-message";
import type { ThemeSource } from "@domicile/component-library/theme-source";

import { rememberedTheme, rememberTheme } from "./remembered-theme";

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
export const hostTheme = (domicile: DomicileClient): ThemeSource => ({
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
});
