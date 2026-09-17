import { Button } from "@domicile/component-library/Button";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/ssr/TerminalWindow";

import { css } from "../../styled-system/css";
import { grid, hstack } from "../../styled-system/patterns";
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
  /** Which bindings are live, which the bar says when it is not the usual set. */
  mode: BindingMode;
  /** The workspaces with something on them, which are the ones shown. */
  occupied: readonly string[];
  /** Open a browser window — what the bar's + does. */
  onNew: () => void;
  /** Launch a terminal onto the desktop. */
  onOpenTerminal: () => void;
  onSelectWorkspace: (name: string) => void;
};

/**
 * The bar across the top of the screen the chrome is on: the workspaces, the
 * clock, and the two things this desktop can launch.
 *
 * **Transparent, and over nothing.** It paints no background, so what is
 * behind it is the wallpaper — and the windows are laid out in what is left of
 * the screen under it, so nothing is behind it but the wallpaper. A window
 * that covers it is one the user put there: a float dragged up, or a window
 * filling the screen.
 *
 * The clock is in the middle of the *bar* rather than in the middle of what
 * the workspaces and the buttons leave, which is what the three columns are
 * for: the one in the middle is centered in the screen whatever is in the
 * other two, so the reading does not shift along as windows open.
 */
export const TopBar = ({
  current,
  mode,
  occupied,
  onNew,
  onOpenTerminal,
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
      <Button
        label="Terminal"
        onClick={onOpenTerminal}
        size="sm"
        variant="ghost"
      >
        <TerminalWindowIcon size={14} />
      </Button>
      <Button label="New window" onClick={onNew} size="sm" variant="ghost">
        <PlusIcon size={14} />
      </Button>
      <ThemeSwitch />
    </div>
  </header>
);

const barStyles = grid({
  // The bar's own controls come from the component library, whose recipes
  // set their own colour; this is what puts the workspace numbers and the
  // launchers' icons on the same footing as the text beside them. The theme
  // switch keeps its own: colour is how it says which way it is set.
  "& button": { color: "white" },
  alignItems: "center",
  // White with a shadow under it, in both themes. The bar paints no
  // background, so nothing separates its text from the photograph behind it
  // — and `foreground` would not do: it flips with the theme, and the
  // wallpaper does not. The shadow is what survives a picture that happens
  // to be white behind any given letter.
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
