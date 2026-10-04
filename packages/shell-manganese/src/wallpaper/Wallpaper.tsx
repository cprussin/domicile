import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { WALLPAPER_PHOTOS } from "./photos";

/** How long each photograph shows before the next fades in. */
const DWELL_MS = 60_000;

/**
 * Crossfade duration in ms. Read from the same token as the CSS transition so
 * the two stay in sync.
 */
const CROSSFADE_MS = Number.parseFloat(token("durations.crossfade")) * 1000;

/**
 * A photograph's role in the rotation. Styles are in {@link layerStyles}.
 *
 * The incoming photograph fades in over an opaque previous one. Fading both
 * at once would let the background show through mid-fade, which looks like a
 * blink.
 */
enum Layer {
  /** On screen, fading in over {@link Layer.Previous}. */
  Current = "current",
  /** Opaque underneath the current photograph until its fade ends. */
  Previous = "previous",
  /** Loaded and transparent. */
  Waiting = "waiting",
}

/**
 * The desktop wallpaper: a photograph rotation that changes every minute. See
 * `packages/shell-manganese/docs/WALLPAPER.md`.
 *
 * - One sheet spans the whole desktop. A `<Screen>` would add a second region
 *   per display, which breaks lookups by `data-screen`.
 * - Both themes' rotations stay mounted and CSS shows one, so a theme switch
 *   shows loaded photographs and needs only the `data-theme` attribute.
 * - It takes no pointer events.
 */
export const Wallpaper = () => {
  const [step, setStep] = useState(0);
  // Whether this step's fade has finished.
  const [settled, setSettled] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((previous) => previous + 1);
      setSettled(false);
    }, DWELL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (settled) {
      return;
    }
    const timer = setTimeout(() => {
      setSettled(true);
    }, CROSSFADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settled]);

  return (
    <div className={sheetStyles}>
      {THEMES.map((theme) => (
        <div
          className={rotationStyles[theme]}
          data-wallpaper-theme={theme}
          key={theme}
        >
          {WALLPAPER_PHOTOS[theme].map((photo, index, photos) => (
            // Empty `alt` because the wallpaper is decorative. The role is an
            // attribute so one stylesheet covers all states and tests can
            // read it.
            <img
              alt=""
              className={layerStyles}
              data-wallpaper={layerOf(index, step, photos.length, settled)}
              key={photo}
              src={photo}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * The role of the photograph at `index` on this `step` of the rotation.
 *
 * At step 0 the previous index is `-1 % n`, which is `-1` and matches no
 * photograph. Once `settled`, there is no previous layer.
 */
const layerOf = (
  index: number,
  step: number,
  length: number,
  settled: boolean,
): Layer => {
  if (index === step % length) {
    return Layer.Current;
  } else if (!settled && index === (step - 1) % length) {
    return Layer.Previous;
  } else {
    return Layer.Waiting;
  }
};

const sheetStyles = css({
  inset: 0,
  // Scopes the layers' `z-index` here. Otherwise the current layer would
  // stack in the page's context, over the chrome and level with floats.
  isolation: "isolate",
  pointerEvents: "none",
  // The viewport is sized to the whole desktop, so this covers every screen.
  position: "fixed",
  // The depth of windows hidden behind a tab (`COVERED` in `placement.ts`).
  // They come later in the document, so they draw over the wallpaper. Higher,
  // the wallpaper would show through a window opening or closing in front.
  zIndex: -2,
});

// `contents` keeps the layers positioned and stacked against the sheet.
const rotationStyles: Record<Theme, string> = {
  dark: css({ _light: { display: "none" } }),
  light: css({ _light: { display: "contents" }, display: "none" }),
};

const layerStyles = css({
  // Stacking comes from the role because on wrap-around the incoming
  // photograph is the earlier element.
  //
  // Only this role transitions. Other role changes happen under an opaque
  // photograph, and a transition on them could draw over the incoming one.
  '&[data-wallpaper="current"]': {
    opacity: 1,
    transition: "opacity {durations.crossfade} {easings.in-out}",
    zIndex: 1,
  },
  '&[data-wallpaper="previous"]': { opacity: 1 },
  blockSize: "100%",
  inlineSize: "100%",
  inset: 0,
  // Crops the photograph to the desktop's shape.
  objectFit: "cover",
  opacity: 0,
  position: "absolute",
});
