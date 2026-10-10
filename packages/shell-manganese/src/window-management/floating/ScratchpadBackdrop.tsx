import { cva } from "../../../styled-system/css";
import type { Rect } from "../rect";
import type { WindowMotion } from "../window-motion";
import { placedAt, rewoundBy } from "../window-styles";

type Props = {
  /** Just under the scratchpad window's depth. */
  depth: number;
  /** The window's motion. The backdrop fades in and out with its slides. */
  motion: WindowMotion;
  /** A press on the backdrop, which hides the window. */
  onDismiss: () => void;
  /** How far into its slide the window starts. See `slidAcross`. */
  rewound: number;
  /** The screen it dims. */
  screen: Rect;
};

/**
 * Dims a screen under the scratchpad window shown on it, which sits over the
 * screen like a modal. A press on it hides the window.
 *
 * A plain element, not the library's `ModalDialog`: the window is a client
 * surface, not page content a dialog could hold. It fades with the window's
 * slides, on the same timing, so it is never darker or lighter than the window
 * is in.
 */
export const ScratchpadBackdrop = ({
  depth,
  motion,
  onDismiss,
  rewound,
  screen,
}: Props) => (
  <div
    aria-hidden
    className={backdropStyles({ motion: fadeOf(motion) })}
    data-motion={motion}
    data-scratchpad-backdrop=""
    onPointerDown={onDismiss}
    style={{
      ...placedAt(screen, depth),
      ...rewoundBy(rewound),
    }}
  />
);

/** The fade for the window's motion: only its slides fade the backdrop. */
const fadeOf = (motion: WindowMotion): "dropping" | "resting" | "stowing" => {
  switch (motion) {
    case "dropping":
    case "stowing": {
      return motion;
    }
    case "arriving-from-end":
    case "arriving-from-start":
    case "closing":
    case "closing-tab":
    case "concealing":
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "opening-tab":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "revealing":
    case "sending":
    case "sending-tab":
    case "uncovering": {
      return "resting";
    }
  }
};

/**
 * Dims like a `ModalDialog` backdrop. Its fades match the window's slides in
 * `movingStyles`; keyframes are in `panda.config.ts`. Ignores the pointer
 * while fading out.
 */
const backdropStyles = cva({
  base: {
    backdropFilter: "blur({spacing.0.5})",
    backgroundColor: "backdrop",
  },
  variants: {
    motion: {
      dropping: {
        animation:
          "backdropShowing {durations.slow} {easings.out} var(--motion-delay, 0ms)",
      },
      resting: {},
      stowing: {
        animation:
          "backdropHiding {durations.slow} {easings.out} var(--motion-delay, 0ms) reverse forwards",
        pointerEvents: "none",
      },
    },
  },
});
