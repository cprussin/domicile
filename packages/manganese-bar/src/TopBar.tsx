import type {
  Anchor,
  Gap,
} from "@domicile-desktop/component-library/FluidItem";
import { FluidItem } from "@domicile-desktop/component-library/FluidItem";
import type { ReactNode } from "react";
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
 * Each item eases its width as what it shows comes, changes and goes, so the
 * others slide aside rather than jump. An item hides by rendering nothing.
 * Items on the right grow leftward, so their right edges, and any panel
 * hung from them, stay put.
 *
 * Memoized, so an item redraws only when the context it reads changes.
 */
export const TopBar = memo(({ layout }: { layout: BarLayout }) => (
  <header className={barStyles} style={{ blockSize: `${TOP_BAR}px` }}>
    <div className={startStyles}>
      {fluid(layout.left, "wide", "start", layout.left.length - 1)}
    </div>
    <div className={centerStyles}>
      {fluid(layout.center, "none", "start", undefined)}
    </div>
    <div className={endStyles}>{fluid(layout.right, "wide", "end", 0)}</div>
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

// Each item holds half the gap on either side, so the column pulls its ends
// in by as much.
const startStyles = hstack({ gap: 0, marginInline: -2 });

const centerStyles = css({ justifySelf: "center" });

// Most items are 28px buttons around a 15px icon, so icons sit 29px apart.
const endStyles = hstack({ gap: 0, justify: "flex-end", marginInline: -2 });

/**
 * `items`, each in a `FluidItem`, keeping their keys. The one at `open`, beside
 * the bar's empty middle, may spill into it while it resizes.
 */
const fluid = (
  items: readonly ReactNode[],
  gap: Gap,
  anchor: Anchor,
  open: number | undefined,
) =>
  Children.map(items, (item, index) => (
    <FluidItem
      anchor={anchor}
      gap={gap}
      overflow={index === open ? "visible" : "clip"}
    >
      {item}
    </FluidItem>
  ));
