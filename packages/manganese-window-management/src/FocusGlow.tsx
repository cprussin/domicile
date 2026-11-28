import { css, cva, cx } from "../styled-system/css";
import type { BoxOverlayPlacement } from "./BoxOverlay";
import { BoxOverlay } from "./BoxOverlay";

/**
 * Its `depth` is that of the windows it lights, and its `rect` the focused
 * window's frame, or its group's.
 */
type Props = BoxOverlayPlacement & {
  /** Whether focus has left the box, so the glow fades out. */
  leaving: boolean;
  /** Called when a fade in or out ends. */
  onFaded: () => void;
  /** The windows inside the box. */
  windows: readonly string[];
};

/**
 * An accent ring and glow around the window or group commands target.
 *
 * - An outer `box-shadow` only, which is never drawn under its own box, so it
 *   lights the gaps around the box and leaves the client's pixels untouched.
 *   Inside a group it does not light the gaps between the windows.
 * - It sits at the windows' depth before every window in the document, so
 *   windows at that depth cover it and windows above it stay above.
 * - It fades in and out in place instead of moving to the next box.
 * - It plays the focused window's motion, moves with its windows, and takes
 *   no pointer events.
 */
export const FocusGlow = ({
  leaving,
  onFaded,
  windows,
  ...placement
}: Props) => (
  <BoxOverlay
    {...placement}
    className={cx(glowStyles, fadeStyles({ leaving }))}
    data-focus-box={windows.join(" ")}
    data-leaving={leaving || undefined}
    onTransitionEnd={(event) => {
      if (event.propertyName === "opacity") {
        onFaded();
      }
    }}
  />
);

/**
 * Rounded like a window's frame.
 *
 * - Dark: a 1px ring, like a window's edge, and a wide glow.
 * - Light: a translucent glow barely shows on a light wallpaper, so a solid
 *   ring with a pale outer band, which reads on light and dark parts of the
 *   photo alike.
 */
const glowStyles = css({
  borderRadius: "lg",
  boxShadow: {
    _light:
      "0 0 0 {spacing.0.75} {colors.accent}, 0 0 0 {spacing.1.25} color-mix(in oklab, {colors.accent} 35%, {colors.background}), 0 0 {spacing.6} {spacing.1.5} color-mix(in oklab, {colors.accent} 50%, transparent), {shadows.lifted}",
    base: "0 0 0 1px color-mix(in oklab, {colors.accent} 70%, transparent), 0 0 {spacing.9} color-mix(in oklab, {colors.accent} 45%, transparent), {shadows.lifted}",
  },
  pointerEvents: "none",
});

/** Eased by `settlingStyles`, which carries the `opacity` transition. */
const fadeStyles = cva({
  base: { _starting: { opacity: 0 } },
  variants: {
    leaving: {
      false: { opacity: 1 },
      true: { opacity: 0 },
    },
  },
});
