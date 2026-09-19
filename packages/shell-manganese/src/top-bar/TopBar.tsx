import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";

import { css } from "../../styled-system/css";
import { grid, hstack } from "../../styled-system/patterns";
import { Battery } from "../battery/Battery";
import { Clock } from "../clock/Clock";
import { BindingMode } from "../window-management/window-state";
import { Workspaces } from "./Workspaces";

/**
 * How tall the bar is.
 *
 * Read by the desktop as well, which takes it off the screen before handing
 * what is left to the windows — so the bar is never behind one and no window
 * has to leave room for it. Written as the element's own size rather than as a
 * Panda length for that reason: one number, in the units the layout is in.
 */
export const TOP_BAR = 32;

type Props = {
  /** The workspace on screen, which the bar marks. */
  current: string;
  /** Where the charge comes from — the bar reads nothing off the machine. */
  domicile: DomicileClient;
  /** Which bindings are live, which the bar says when it is not the usual set. */
  mode: BindingMode;
  /** The workspaces with something on them, which are the ones shown. */
  occupied: readonly string[];
  onSelectWorkspace: (name: string) => void;
};

/**
 * The bar across the top of the screen the chrome is on: the workspaces, the
 * clock, and the charge.
 *
 * **It launches nothing.** Everything this desktop does is on a key, and two
 * buttons for two of those keys were a ranking nobody made — the terminal is
 * `mod+Return` and the launcher, which is what opens a window on a URL or a
 * search, is `mod+Space`. Both are where sway's config puts them and so where
 * a user of this desktop already looks. What is on the bar is what no key can
 * be pressed to ask: which workspace this is, what time it is, and how much
 * charge is left.
 *
 * **Over nothing but the wallpaper.** The windows are laid out in what is left
 * of the screen under it, so nothing is behind it but the picture. A window
 * that covers it is one the user put there: a float dragged up, or a window
 * filling the screen.
 *
 * **What it paints is a scrim.** Not a surface: a black gradient that fades
 * to nothing by the bar's own lower edge, so the bar still ends in the
 * wallpaper rather than against a line — and the white text has something
 * dark under it when the picture behind it is bright.
 *
 * The clock is in the middle of the *bar* rather than in the middle of what
 * the workspaces and the charge leave, which is what the three columns are
 * for: the one in the middle is centered in the screen whatever is in the
 * other two, so the reading does not shift along as windows open.
 */
export const TopBar = ({
  current,
  domicile,
  mode,
  occupied,
  onSelectWorkspace,
}: Props) => (
  <header className={barStyles} style={{ blockSize: `${TOP_BAR}px` }}>
    <Workspaces
      current={current}
      occupied={occupied}
      onSelect={onSelectWorkspace}
    />
    <div className={middleStyles}>
      <Clock />
    </div>
    <div className={endStyles}>
      {mode === BindingMode.Resize && (
        <span className={modeStyles}>resize</span>
      )}
      <Battery domicile={domicile} />
    </div>
  </header>
);

const barStyles = grid({
  // The workspace buttons come from the component library, whose recipes set
  // their own colour; this is what puts the workspace numbers on the same
  // footing as the text beside them.
  "& button": { color: "white" },
  alignItems: "center",
  // The scrim under the text, which is the bar's whole background: it fades
  // out within the bar's own height, so there is no edge where it stops and
  // the wallpaper carries on.
  backgroundImage: "{gradients.scrimOverPhoto}",
  // White with a shadow under it, in both themes — `foreground` would not
  // do: it flips with the theme, and the wallpaper does not. The scrim
  // darkens the band and the shadow draws each letter off it; a picture
  // bright behind one word and dark behind the next needs both.
  color: "white",
  // Three columns, the outer two equal: what is in them can be any width and
  // the middle one stays in the middle of the screen.
  gridTemplateColumns: "1fr auto 1fr",
  insetBlockStart: 0,
  insetInline: 0,
  paddingInline: 2,
  position: "absolute",
  textShadow: "textOverPhoto",
});

const middleStyles = css({ justifySelf: "center" });

const endStyles = hstack({ gap: 1, justify: "flex-end" });

// Not a colour of its own: the bar's text is white over a photograph, and
// what marks this out is that it is a word in capitals where the rest of the
// bar is numbers and a clock.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});
