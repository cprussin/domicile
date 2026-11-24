import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useEffect, useState } from "react";

/** The pinch the overview follows; its bindings are `pinch:4:*`. */
const FINGERS = 4;

/**
 * How far open a four-finger pinch has the overview, 0 to 1, while one is
 * under way, or `undefined`. Pinching in opens it, fully at half the fingers'
 * spread; spreading closes it, fully at twice. Either turns back as the
 * fingers do.
 *
 * Once the fingers lift, the pinch's binding opens or closes the overview
 * (see `DEFAULT_KEYBINDINGS`), and it settles there from where the pinch left
 * it.
 */
export const useOverviewPinch = (
  gestures: Pick<Domicile["gestures"], "on">,
  open: boolean,
): number | undefined => {
  const [progress, setProgress] = useState<number | undefined>();
  useEffect(
    () =>
      gestures.on("gesture", ({ fingers, kind, phase, scale }) => {
        if (kind === "pinch" && fingers === FINGERS) {
          switch (phase) {
            case "begin":
            case "update": {
              setProgress(progressOf(open, scale));
              break;
            }
            case "end": {
              setProgress(undefined);
              break;
            }
          }
        }
      }),
    [gestures, open],
  );
  return progress;
};

/**
 * How far open a pinch to `scale` of its fingers' spread has the overview,
 * from open or closed. Even in halvings and doublings of the spread, as the
 * fingers move.
 */
const progressOf = (open: boolean, scale: number): number =>
  clamped(open ? 1 - Math.log2(scale) : -Math.log2(scale));

const clamped = (progress: number): number =>
  Math.min(1, Math.max(0, progress));
