import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Theme } from "./theme-core";
import {
  applyTheme,
  DEFAULT_THEME,
  flipThemeWithAnimation,
  OTHER_THEME,
} from "./theme-core";
import type { ThemeSource } from "./theme-source";

/**
 * The theme control a theme widget reads: which way round the page is drawn
 * now, and a `flip` that asks for the other one.
 *
 * `flip` is a request and not a setter — see {@link ThemeSource.setTheme}. What
 * changes `theme` is the desk answering, which is also what animates.
 */
export type ThemeControl = {
  theme: Theme;
  flip: () => void;
};

const ThemeContext = createContext<ThemeControl | undefined>(undefined);

/**
 * The theme control for every theme consumer below it.
 *
 * It mirrors the theme onto `<html>` — on mount, and on every answer from the
 * source — and runs the {@link flipThemeWithAnimation} wipe when the answer is
 * a change. The app mounts it around its root, the way an intent provider is:
 * theme is app chrome, so the rest of the tree stays theme-agnostic and just
 * reads {@link useTheme}.
 *
 * **It owns no theme of its own, which is the point of `source`.** The theme
 * belongs to the desktop: it starts as `[theme] mode` in the compositor's
 * config, the same value reaches the desk's Wayland clients through the
 * settings portal, and a desk of three monitors is three pages that have to
 * move together. So nothing here reads `prefers-color-scheme` and nothing here
 * writes `localStorage` — both were a second place for the answer to live, and
 * the second place is the one that goes wrong.
 *
 * `source` is read on mount and re-read whenever its identity changes: it is
 * the connection, and a new one may already have been told a theme. It has to
 * be as stable as a connection — see {@link ThemeSource}.
 */
export const ThemeProvider = ({
  children,
  source,
}: PropsWithChildren<{ source: ThemeSource }>) => {
  const [theme, setTheme] = useState<Theme>(source.theme ?? DEFAULT_THEME);

  // What is on `<html>` right now, which is not the same thing as what React
  // has committed: the wipe applies the new theme mid-flight and commits it
  // 500ms later. A ref rather than state because nothing renders from it —
  // it exists so the effect below can tell an answer that changes something
  // from one that restates what the page is already painting in.
  const painted = useRef(theme);

  // Apply on mount and on every committed change. Idempotent: the flip has
  // already applied it mid-animation, and a page whose entry point applied the
  // theme pre-paint is applying it a third time to the same value.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const told = (next: Theme) => {
      const previous = painted.current;
      // Restating what the page is already in is the ordinary case, not the
      // odd one — a source replays what it holds to a handler that has only
      // just registered — and animating it would run the wipe over a theme
      // that did not change.
      if (previous !== next) {
        painted.current = next;
        flipThemeWithAnimation({
          applyNextTheme: () => {
            applyTheme(next);
          },
          commitTheme: () => {
            setTheme(next);
          },
          next,
          previous,
          turnWindows: () => source.turnWindows(next),
        });
      }
    };
    // What the source already holds, before what it says next: a changed
    // source is a new connection and may have been told a theme before this
    // provider existed. `useState`'s initializer does not run twice, and
    // `onTheme` is only obliged to deliver what comes *after* it registers.
    if (source.theme !== undefined) {
      told(source.theme);
    }
    return source.onTheme(told);
  }, [source]);

  const flip = useCallback(() => {
    source.setTheme(OTHER_THEME[theme]);
  }, [source, theme]);

  const value = useMemo(() => ({ flip, theme }), [flip, theme]);
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
