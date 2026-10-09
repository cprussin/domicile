// A photograph's role in the wallpaper, and the styles for each role.

import { css } from "../../styled-system/css";

/**
 * A photograph's role in the rotation. Styles are in {@link layerStyles}.
 *
 * The incoming photograph fades in over an opaque previous one. Fading both
 * at once would let the background show through mid-fade, which looks like a
 * blink.
 */
export enum Layer {
  /** On screen, fading in over {@link Layer.Previous}. */
  Current = "current",
  /** Opaque underneath the current photograph until its fade ends. */
  Previous = "previous",
  /** Transparent: loading, or loaded and waiting for its turn. */
  Waiting = "waiting",
  /** The photograph from the repository, opaque under the rotation. */
  Fallback = "fallback",
}

/** Each role's opacity, stacking and fade, set by `data-wallpaper`. */
export const layerStyles = css({
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
  '&[data-wallpaper="fallback"], &[data-wallpaper="previous"]': {
    opacity: 1,
  },
  blockSize: "100%",
  inlineSize: "100%",
  inset: 0,
  // Crops the photograph to the monitor's shape.
  objectFit: "cover",
  opacity: 0,
  position: "absolute",
});
