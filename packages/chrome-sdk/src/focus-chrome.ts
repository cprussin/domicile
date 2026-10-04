// Returns keyboard focus to the chrome's page.

import type { DomicileClient } from "./domicile-client";
import { setFocusedApp } from "./element-context";

/**
 * Route the keyboard back to the chrome's own page.
 *
 * Use this instead of `domicile.focusChrome()`, which only moves the
 * compositor's seat; without this the SDK keeps forwarding keys to the last
 * client. Clicking the chrome already does this. Call it when the shell shows
 * a panel over the windows, such as a launcher. See `shell-manganese`'s
 * `AppWindow`.
 */
export const focusChrome = (domicile: DomicileClient): void => {
  setFocusedApp(undefined);
  domicile.focusChrome();
};
