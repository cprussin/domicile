import { cva } from "../../../styled-system/css";
import type { Rect } from "../rect";
import { placedAt } from "../window-styles";

type Props = {
  /** Just under the scratchpad window's depth. */
  depth: number;
  /** Whether the window is sliding away, so the backdrop fades out. */
  leaving: boolean;
  /** A press on the backdrop, which hides the window. */
  onDismiss: () => void;
  /** The screen it dims. */
  screen: Rect;
};

/**
 * Dims a screen under the scratchpad window shown on it, which sits over the
 * screen like a modal. A press on it hides the window.
 *
 * A plain element, not the library's `ModalDialog`: the window is a client
 * surface, not page content a dialog could hold. It fades in on mount and out
 * while the window slides away.
 */
export const ScratchpadBackdrop = ({
  depth,
  leaving,
  onDismiss,
  screen,
}: Props) => (
  <div
    aria-hidden
    className={backdropStyles({ leaving })}
    data-scratchpad-backdrop=""
    onPointerDown={onDismiss}
    style={placedAt(screen, depth)}
  />
);

/** Dims like a `ModalDialog` backdrop. Ignores the pointer while fading out. */
const backdropStyles = cva({
  base: {
    _starting: { opacity: 0 },
    backdropFilter: "blur({spacing.0.5})",
    backgroundColor: "backdrop",
    transition: "opacity {durations.slow} {easings.emphasized}",
  },
  variants: {
    leaving: {
      false: { opacity: 1 },
      true: { opacity: 0, pointerEvents: "none" },
    },
  },
});
