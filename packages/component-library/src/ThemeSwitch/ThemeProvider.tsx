import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ResolvedTheme, ThemePreference } from "./theme-core";
import {
  cycleThemeWithAnimation,
  THEME_CYCLE,
  THEME_PREFERENCES,
} from "./theme-core";

// The domicile Panda preset publishes both dark (`base`) and light (`_light`)
// values for every primitive semantic color; `data-theme="light"` on `<html>`
// flips to light via the preset's `_light` condition
// (`[data-theme=light] &`). No attribute means dark. Three persisted
// preferences — `light`, `dark`, `system` (follow the OS) — collapse to the
// concrete `light | dark` actually applied.

const THEME_KEY = "theme:v1";

/** What the preset's `_light` condition selects on. */
const THEME_ATTRIBUTE = "data-theme";

const isPreference = (value: string): value is ThemePreference =>
  (THEME_PREFERENCES as readonly string[]).includes(value);

const prefersLight = (): boolean =>
  globalThis.matchMedia?.("(prefers-color-scheme: light)").matches === true;

/** The saved theme preference, defaulting to `system` so a fresh install
 *  follows the OS until the user picks. Safe before React mounts — the app can
 *  call it to apply the theme pre-paint. */
export const loadPreference = (): ThemePreference => {
  const stored = globalThis.localStorage?.getItem(THEME_KEY);
  return stored !== null && stored !== undefined && isPreference(stored)
    ? stored
    : "system";
};

const savePreference = (preference: ThemePreference): void => {
  globalThis.localStorage?.setItem(THEME_KEY, preference);
};

/** Collapses a preference into the concrete theme to apply: `system` defers to
 *  `prefers-color-scheme`; explicit `light`/`dark` pass through. */
export const resolveTheme = (preference: ThemePreference): ResolvedTheme => {
  if (preference === "system") {
    return prefersLight() ? "light" : "dark";
  } else {
    return preference;
  }
};

/** Applies a preference to `<html>` by setting `data-theme` — dark is the
 *  attribute-less default, matching the preset's `_light` condition. */
export const applyPreference = (preference: ThemePreference): void => {
  const root = globalThis.document?.documentElement;
  if (resolveTheme(preference) === "light") {
    root?.setAttribute(THEME_ATTRIBUTE, "light");
  } else {
    root?.removeAttribute(THEME_ATTRIBUTE);
  }
};

const watchSystemTheme = (
  onChange: (theme: ResolvedTheme) => void,
): (() => void) => {
  const mq = globalThis.matchMedia?.("(prefers-color-scheme: light)");
  if (mq === undefined) {
    return () => undefined;
  }
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "light" : "dark");
  };
  mq.addEventListener("change", handler);
  return () => {
    mq.removeEventListener("change", handler);
  };
};

/**
 * The theme control a theme widget reads: the current `preference` and a `cycle`
 * callback that advances it (light → dark → follow-system → light).
 */
export type ThemeControl = {
  preference: ThemePreference;
  cycle: () => void;
};

const ThemeContext = createContext<ThemeControl | undefined>(undefined);

/**
 * The theme control for every theme consumer below it — the persisted
 * preference and an animated `cycle`. This is the batteries-included
 * controller: it loads and saves the preference, mirrors the resolved theme onto
 * `<html>` (on mount, on cycle, and on OS changes while following the system),
 * and runs the {@link cycleThemeWithAnimation} wipe on each cycle. The app mounts
 * it around its root, the way an intent provider is — theme is app chrome, so
 * the rest of the tree stays theme-agnostic and just reads {@link useTheme}.
 */
export const ThemeProvider = ({ children }: PropsWithChildren) => {
  const [preference, setPreference] = useState<ThemePreference>(loadPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system"),
  );

  const cycle = useCallback(() => {
    const next = THEME_CYCLE[preference];
    savePreference(next);
    // Resolve `system` from the tracked OS state so the wipe picks the right
    // direction even before the effect below re-applies.
    const resolveFromState = (pref: ThemePreference): ResolvedTheme =>
      pref === "system" ? systemTheme : pref;
    cycleThemeWithAnimation({
      applyResolvedTheme: () => {
        applyPreference(next);
      },
      commitPreference: () => {
        setPreference(next);
      },
      nextResolved: resolveFromState(next),
      previousResolved: resolveFromState(preference),
    });
  }, [preference, systemTheme]);

  // Apply the current preference to `<html>` on mount and on every change (the
  // cycle also applies mid-animation; this re-apply is idempotent).
  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  // Track the OS theme; mirror it onto `<html>` only while following system.
  useEffect(
    () =>
      watchSystemTheme((next) => {
        setSystemTheme(next);
        if (preference === "system") {
          applyPreference("system");
        }
      }),
    [preference],
  );

  const value = useMemo(() => ({ cycle, preference }), [cycle, preference]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

/**
 * The current theme control. Throws when nothing is listening: a theme consumer
 * is only ever mounted in an app that mounted a {@link ThemeProvider}, so a
 * missing one is a wiring bug to surface, not a silent default.
 */
export const useTheme = (): ThemeControl => {
  const control = useContext(ThemeContext);
  if (control === undefined) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  } else {
    return control;
  }
};
