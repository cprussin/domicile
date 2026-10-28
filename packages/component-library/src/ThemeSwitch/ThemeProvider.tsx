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
import { flushSync } from "react-dom";

import type { Theme } from "./theme-core";
import {
  applyTheme,
  DEFAULT_THEME,
  flipThemeWithAnimation,
  OTHER_THEME,
} from "./theme-core";
import type { ThemeSource } from "./theme-source";

/**
 * The current `theme` and a `flip` that requests the other one.
 *
 * `flip` only sends a request ({@link ThemeSource.setTheme}). `theme` changes,
 * with animation, when the source reports the new theme. `flipping` is true
 * from that report until the animation ends and `theme` commits. `painted`
 * is the theme the page is drawn in: it changes as the wipe starts, so what
 * reads it wipes over to its new state with the rest of the screen.
 */
export type ThemeControl = {
  theme: Theme;
  flip: () => void;
  flipping: boolean;
  painted: Theme;
};

const ThemeContext = createContext<ThemeControl | undefined>(undefined);

/**
 * Provides {@link useTheme}. Mount it around the app root.
 *
 * Writes the theme to `<html>` and runs the {@link flipThemeWithAnimation}
 * wipe when the source reports a change. It keeps no theme of its own, and
 * ignores `prefers-color-scheme` and `localStorage`: the theme comes from the
 * compositor config and must match across monitors and Wayland clients.
 *
 * `source` must be stable; a new identity is treated as a new connection. See
 * {@link ThemeSource}.
 */
export const ThemeProvider = ({
  children,
  source,
}: PropsWithChildren<{ source: ThemeSource }>) => {
  const [theme, setTheme] = useState<Theme>(source.theme ?? DEFAULT_THEME);
  const [flipping, setFlipping] = useState(false);
  const [painted, setPainted] = useState(theme);

  // The theme the source reported last, which leads `painted` by the wait
  // before the wipe. Lets the effect below skip reports that change nothing.
  const reported = useRef(theme);

  // Idempotent; the wipe or the page's entry point may have applied it
  // already.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const told = (next: Theme) => {
      const previous = reported.current;
      // Sources replay their current theme on registration, so an unchanged
      // theme is common and must not animate.
      if (previous !== next) {
        reported.current = next;
        setFlipping(true);
        flipThemeWithAnimation({
          applyNextTheme: () => {
            // Rendered now, so the wipe's new frame holds it.
            flushSync(() => {
              setPainted(next);
            });
            applyTheme(next);
          },
          commitTheme: () => {
            setTheme(next);
            setFlipping(false);
          },
          next,
          previous,
          turnWindows: () => source.turnWindows(next),
        });
      }
    };
    // A new source may already hold a theme, and `onTheme` only reports later
    // changes.
    if (source.theme !== undefined) {
      told(source.theme);
    }
    return source.onTheme(told);
  }, [source]);

  const flip = useCallback(() => {
    source.setTheme(OTHER_THEME[theme]);
  }, [source, theme]);

  const value = useMemo(
    () => ({ flip, flipping, painted, theme }),
    [flip, flipping, painted, theme],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

/** The current theme control. Throws without a {@link ThemeProvider}. */
export const useTheme = (): ThemeControl => {
  const control = useContext(ThemeContext);
  if (control === undefined) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  } else {
    return control;
  }
};
