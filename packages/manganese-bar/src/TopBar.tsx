import { Children, memo } from "react";

import { css } from "../styled-system/css";
import { grid, hstack } from "../styled-system/patterns";
import type { BarLayout } from "./bar-layout";

/**
 * The bar's height.
 *
 * The desktop also reads it and removes it from the screen before laying out
 * windows, so no window sits behind the bar. A plain number, in the layout's
 * units, for that reason.
 */
export const TOP_BAR = 32;

/**
 * The bar across the top of a screen: three columns of items. Items read what
 * they show from context, and the bar they are on from `BarContext`,
 * which the caller provides.
 *
 * Windows are laid out below it, so only the wallpaper is behind it unless the
 * user drags a float up or fills the screen.
 *
 * It paints a dark gradient behind the text that extends below the bar, so it
 * fades into the wallpaper instead of ending at a line.
 *
 * The center column is centered on the screen regardless of the outer columns,
 * so the clock does not shift as items change.
 *
 * Memoized, so an item redraws only when the context it reads changes.
 */
export const TopBar = memo(({ layout }: { layout: BarLayout }) => (
  <header className={barStyles} style={{ blockSize: `${TOP_BAR}px` }}>
    <div className={startStyles}>{Children.toArray(layout.left)}</div>
    <div className={centerStyles}>{Children.toArray(layout.center)}</div>
    <div className={endStyles}>{Children.toArray(layout.right)}</div>
  </header>
));

const barStyles = grid({
  // No focus ring in the bar: the browser's default color clashes with the
  // wallpaper, and the panels already show what was opened.
  "& *": {
    outline: "none",
  },
  // The scrim extends below the bar. A gradient within the bar's 32px is
  // weakest just under the text, where a bright wallpaper shows through most.
  // Extending it puts the text in the dark part.
  //
  // A separate layer because a background stops at the box. It ignores the
  // pointer since it overlaps windows. `zIndex: -1` puts it under the bar's
  // text; `isolation` below keeps it above the wallpaper.
  "&::before": {
    backgroundImage: "{gradients.scrimOverPhoto}",
    content: '""',
    insetBlockEnd: -4,
    insetBlockStart: 0,
    insetInline: 0,
    pointerEvents: "none",
    position: "absolute",
    zIndex: -1,
  },
  alignItems: "center",
  // White with a shadow in both themes, because the wallpaper does not change
  // with the theme. The scrim darkens the band and the shadow separates each
  // letter from busy images.
  //
  // Buttons inherit this through the preflight reset's `color: inherit`. The
  // theme toggle depends on it: it draws in `currentcolor`, so without this it
  // would turn black on a light desktop.
  color: "white",
  // Equal outer columns keep the center one centered on the screen.
  gridTemplateColumns: "1fr auto 1fr",
  insetBlockStart: 0,
  insetInline: 0,
  // Creates a stacking context so the scrim's `zIndex: -1` stays behind the
  // bar's content rather than behind the wallpaper.
  isolation: "isolate",
  paddingInline: 3,
  position: "absolute",
  textShadow: "textOverPhoto",
});

const startStyles = hstack({ gap: 4 });

const centerStyles = css({ justifySelf: "center" });

const endStyles = hstack({ gap: 3, justify: "flex-end" });
