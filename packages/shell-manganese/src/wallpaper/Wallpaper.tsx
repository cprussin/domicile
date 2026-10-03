import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { WALLPAPER_PHOTOS } from "./photos";

/** How long one photograph stays up before the next fades in over it. */
const DWELL_MS = 60_000;

/**
 * How long the fade takes, after which the photograph it left is put away.
 * The token the transition below is written in, so the two cannot disagree.
 */
const CROSSFADE_MS = Number.parseFloat(token("durations.crossfade")) * 1000;

/**
 * What a layer is to the rotation, which is the whole of how the fade works.
 *
 * Every photograph is mounted all the time — that is what has them loaded
 * before their turn — so what changes on a tick is which of three things each
 * one is. The CSS is in {@link layerStyles} and the reason for the third state
 * is the dissolve: the photograph coming in rises from transparent *over* one
 * that is still opaque, so the two alphas always sum to a covered screen.
 * Fading one out as the other rises would leave the theme's `background`
 * showing through the middle of every transition, at a quarter strength,
 * which reads as the desktop blinking.
 */
enum Layer {
  /** On screen, rising over {@link Layer.Previous}. */
  Current = "current",
  /**
   * Still opaque underneath it, until the one above has arrived — and then
   * put away, so that it is transparent again before its next turn.
   */
  Previous = "previous",
  /** Loaded, transparent, waiting its turn. */
  Waiting = "waiting",
}

/**
 * The desktop's wallpaper: a photograph behind everything, and the next one a
 * minute later.
 *
 * One sheet for the whole desktop rather than one per screen. The page spans
 * every display, so `position: fixed` *is* the desktop — and a `<Screen>` of
 * its own would put a second region on every display, which is one region too
 * many for anything that looks a display up by `data-screen`.
 *
 * **One rotation per theme**, both mounted and stepping together, and CSS
 * showing whichever the desk is in. Mounted rather than chosen in React so the
 * other theme's photographs are loaded before a flip — the wipe reveals one
 * that is already here — and so the flip is the `data-theme` attribute alone,
 * like the rest of the page's colors.
 *
 * **It takes no pointer.** Paint and nothing else: the desktop behind the
 * chrome was never a hit target, and a sheet over the whole of it that took the
 * pointer would make it one.
 */
export const Wallpaper = () => {
  const [step, setStep] = useState(0);
  // Whether this step's fade is over, and the photograph it left put away.
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
            // `alt=""`, because a wallpaper is decoration: there is nothing
            // here to announce to a reader that the chrome in front of it does
            // not say better. The role is an attribute rather than a class so
            // that one stylesheet covers all three states — and so the
            // rotation is legible from outside, which is what its tests read.
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
 * Which role the photograph at `index` plays on this step of the rotation.
 *
 * `step` counts up for ever and a rotation's `length` photographs are a ring,
 * so the modulus is what turns one into the other. The previous step needs no
 * guard for the first tick: `-1 % n` is `-1`, which is no photograph's index.
 *
 * Once the fade is `settled` there is no previous: every photograph but the
 * one on screen is transparent, which is what lets each of them rise from
 * nothing when its turn comes — the photograph a rotation of two comes back
 * to included.
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
  // Keeps the current layer's `z-index` to itself. Without a stacking context
  // here that 1 is in the *page's*, where it would be a wallpaper painted over
  // the chrome — and level with a floating window, which is the one thing on
  // this page that stacks by number.
  isolation: "isolate",
  pointerEvents: "none",
  // The viewport is the desktop: the compositor configures this window to the
  // desktop's own size, so a fixed sheet at the origin covers every screen.
  position: "fixed",
  // Under the page's own stack, at the depth of a window a tab is hiding —
  // `COVERED` in `placement.ts` — which comes later in the document and so is
  // drawn over it. Left at the page's own level it would cover those windows,
  // and show through a window opening or closing in front of one.
  zIndex: -2,
});

// `contents`, so a rotation is no box of its own: its layers stay positioned
// against the sheet, and stacked in the sheet's isolated context.
const rotationStyles: Record<Theme, string> = {
  dark: css({ _light: { display: "none" } }),
  light: css({ _light: { display: "contents" }, display: "none" }),
};

const layerStyles = css({
  // The stacking is the role's, not the markup's: the photograph coming in has
  // to be over the one going out, and at the end of the rotation it is the
  // earlier element of the two.
  //
  // AND THE FADE IS ITS ALONE. Every other change of role happens under an
  // opaque photograph, so it is never seen; a transition on one would run
  // over the top of the one coming in wherever the markup put it later.
  '&[data-wallpaper="current"]': {
    opacity: 1,
    transition: "opacity {durations.crossfade} {easings.in-out}",
    zIndex: 1,
  },
  '&[data-wallpaper="previous"]': { opacity: 1 },
  blockSize: "100%",
  inlineSize: "100%",
  inset: 0,
  // A photograph is not the shape of a desktop; this is the half of the answer
  // the size in the URL is not.
  objectFit: "cover",
  opacity: 0,
  position: "absolute",
});
