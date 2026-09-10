import { useEffect, useState } from "react";

import { css } from "../styled-system/css";
import { WALLPAPER_PHOTOS } from "./wallpaper-photos";

/** How long one photograph stays up before the next fades in over it. */
const DWELL_MS = 60_000;

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
  /** Still opaque underneath it, until the one above has arrived. */
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
 * **It takes no pointer.** Paint and nothing else: the desktop behind the
 * chrome was never a hit target, and a sheet over the whole of it that took the
 * pointer would make it one.
 */
export const Wallpaper = () => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((previous) => previous + 1);
    }, DWELL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className={sheetStyles}>
      {WALLPAPER_PHOTOS.map((photo, index) => (
        // `alt=""`, because a wallpaper is decoration: there is nothing here to
        // announce to a reader that the chrome in front of it does not say
        // better. The role is an attribute rather than a class so that one
        // stylesheet covers all three states — and so the rotation is legible
        // from outside, which is what its tests read.
        <img
          alt=""
          className={layerStyles}
          data-wallpaper={layerOf(index, step)}
          key={photo}
          src={photo}
        />
      ))}
    </div>
  );
};

/**
 * Which role the photograph at `index` plays on this step of the rotation.
 *
 * `step` counts up for ever and the photographs are a ring, so the modulus is
 * what turns one into the other. The previous step needs no guard for the first
 * tick: `-1 % n` is `-1`, which is no photograph's index.
 */
const layerOf = (index: number, step: number): Layer => {
  if (index === step % WALLPAPER_PHOTOS.length) {
    return Layer.Current;
  } else if (index === (step - 1) % WALLPAPER_PHOTOS.length) {
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
});

const layerStyles = css({
  // The stacking is the role's, not the markup's: the photograph coming in has
  // to be over the one going out, and at the end of the rotation it is the
  // earlier element of the two.
  '&[data-wallpaper="current"]': { opacity: 1, zIndex: 1 },
  '&[data-wallpaper="previous"]': { opacity: 1 },
  blockSize: "100%",
  inlineSize: "100%",
  inset: 0,
  // A photograph is not the shape of a desktop; this is the half of the answer
  // the size in the URL is not.
  objectFit: "cover",
  opacity: 0,
  position: "absolute",
  transition: "opacity {durations.crossfade} {easings.in-out}",
});
