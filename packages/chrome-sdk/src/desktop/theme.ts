// The desk's light or dark theme, which the compositor owns because the
// settings portal serves it to applications too.

import type { DomicileHost, DomicileTheme } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type ThemeListeners = {
  /** {@link Theme.current} changed. */
  change: () => void;
  /** {@link Theme.windows} changed: the windows have turned. */
  windowschange: () => void;
};

export type Theme = {
  /** `undefined` until the compositor says. */
  readonly current: DomicileTheme | undefined;
  /** The theme the windows have turned to; see {@link Theme.captured}. */
  readonly windows: DomicileTheme | undefined;
  /** Turn the desk; answered with `change` to every page, this one included. */
  set: (theme: DomicileTheme) => void;
  /**
   * The page's old frame is held for `theme`: turn the windows now. Called
   * from inside a shell's wipe; answered with `windowschange`.
   */
  captured: (theme: DomicileTheme) => void;
  on: On<ThemeListeners>;
};

export type ThemeHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "removeEventListener"
  | "setTheme"
  | "theme"
  | "themeCaptured"
  | "windowsTheme"
>;

export const theme = (host: ThemeHost): Theme => ({
  captured: (captured) => {
    host.themeCaptured(captured);
  },
  get current() {
    return host.theme ?? undefined;
  },
  on: on<ThemeListeners>({
    change: (listener) => hostEvent(host, "themechanged", () => listener()),
    windowschange: (listener) =>
      hostEvent(host, "windowsthemechanged", () => listener()),
  }),
  set: (next) => {
    host.setTheme(next);
  },
  get windows() {
    return host.windowsTheme ?? undefined;
  },
});
