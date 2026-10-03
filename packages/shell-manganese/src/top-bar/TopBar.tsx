import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import type { TrayItem } from "@domicile/chrome-sdk/tray";
import { ThemeSwitch } from "@domicile/component-library/ThemeSwitch";

import { css } from "../../styled-system/css";
import { grid, hstack } from "../../styled-system/patterns";
import { Battery } from "../battery/Battery";
import { Brightness } from "../brightness/Brightness";
import { Clock } from "../clock/Clock";
import { LauncherButton } from "../launcher/LauncherButton";
import { NotificationBell } from "../notifications/NotificationBell";
import { Tray } from "../tray/Tray";
import type { TrayOrder } from "../tray/useTrayOrder";
import { Volume } from "../volume/Volume";
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
  /**
   * Where the charge and the brightness come from — the bar reads nothing off
   * the machine — and what an extension's action and a new brightness are
   * clicked through.
   */
  domicile: DomicileClient;
  /** The extensions with an action, which the tray shows. */
  extensions: readonly Extension[];
  /** Whether the keyboard is on this screen. */
  focused: boolean;
  /**
   * The binding mode the keys are read in, which the bar names when it is not
   * the usual `default`.
   */
  mode: string;
  /** Open an extension's popup, or close the open one with `undefined`. */
  onOpenExtension: (id: string | undefined) => void;
  /** Open the launcher. */
  onOpenLauncher: () => void;
  /** Open the drawer of notifications. */
  onOpenNotifications: () => void;
  onSelectWorkspace: (name: string) => void;
  /** The extension whose popup is open, or `undefined`. */
  openedExtension: string | undefined;
  /** The applications' tray icons. */
  tray: readonly TrayItem[];
  /** The order the tray is in, and how a drag changes it. */
  trayOrder: TrayOrder;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
  /** The workspaces this screen has, which are the ones shown. */
  workspaces: readonly string[];
};

/**
 * The bar across the top of the screen the chrome is on: the launcher's
 * button, the tray and the workspaces, the clock, the volume, the brightness
 * and the charge.
 *
 * **The launcher's button is first, at the far start**, a little apart from
 * the tray so it does not read as one of the tray's icons. It is the panel
 * `mod+Space` opens, for a hand already on the pointer. The terminal has no
 * button: it is `mod+Return`, where sway's config puts it.
 *
 * **The tray is left of the workspaces**, and it launches nothing of the
 * desktop's: each icon is an application's StatusNotifierItem or an
 * extension's toolbar button, in one row in the order the user dragged them
 * into, whose clicks are theirs and have no key.
 *
 * **The volume is the brightness's case**, and sits beside it: a speaker
 * whose panel holds the whole mixer — the default output and microphone
 * first, and every device, stream and card a section below.
 *
 * **The brightness is the theme toggle's case, below**: it changes the screen
 * already in front of you rather than putting anything on it. Its slider
 * opens off the sun; the wheel over the sun moves it without opening.
 *
 * **The theme toggle changes what is already on screen** rather than putting
 * something new on it, and there is no key to press instead, because a theme
 * is not a thing a desk does often enough to spend a chord on. It has two positions rather than three: this bar *is* the system,
 * so there is nothing above it for a `system` to follow. What a click does is
 * ask the compositor, which answers every page on the desk and hands the same
 * value to the settings portal the desk's GTK and Qt windows read — so the
 * windows turn over with the panels rather than after them.
 *
 * **Over nothing but the wallpaper.** The windows are laid out in what is left
 * of the screen under it, so nothing is behind it but the picture. A window
 * that covers it is one the user put there: a float dragged up, or a window
 * filling the screen.
 *
 * **What it paints is a scrim.** Not a surface: a black gradient behind the
 * text, hanging half the bar's height below the bar so it has room to fade to
 * nothing — the bar still ends in the wallpaper rather than against a line,
 * and the text's own row is in the dark part of the ramp rather than the
 * thin end of it. It takes no pointer, so the stage under the overhang is
 * still the stage.
 *
 * **The bell is last, at the far end**, because the drawer it opens slides
 * out from that edge: the control and what it opens are on the same side of
 * the screen. It opens what the desk has already been told, rather than
 * starting anything.
 *
 * The clock is in the middle of the *bar* rather than in the middle of what
 * the workspaces and the charge leave, which is what the three columns are
 * for: the one in the middle is centered in the screen whatever is in the
 * other two, so the reading does not shift along as windows open.
 */
export const TopBar = ({
  current,
  domicile,
  extensions,
  focused,
  mode,
  onOpenExtension,
  onOpenLauncher,
  onOpenNotifications,
  onSelectWorkspace,
  openedExtension,
  tray,
  trayOrder,
  unread,
  workspaces,
}: Props) => (
  <header className={barStyles} style={{ blockSize: `${TOP_BAR}px` }}>
    <div className={startStyles}>
      <LauncherButton onOpen={onOpenLauncher} />
      <Tray
        domicile={domicile}
        extensions={extensions}
        items={tray}
        onMove={trayOrder.move}
        onOpen={onOpenExtension}
        opened={openedExtension}
        order={trayOrder.order}
      />
      <Workspaces
        current={current}
        focused={focused}
        onSelect={onSelectWorkspace}
        workspaces={workspaces}
      />
    </div>
    <div className={middleStyles}>
      <Clock />
    </div>
    <div className={endStyles}>
      {mode !== "default" && <span className={modeStyles}>{mode}</span>}
      <ThemeSwitch />
      <Volume domicile={domicile} />
      <Brightness domicile={domicile} />
      <Battery domicile={domicile} />
      <NotificationBell onOpen={onOpenNotifications} unread={unread} />
    </div>
  </header>
);

const barStyles = grid({
  // THE SCRIM, and it hangs below the bar rather than filling it. A gradient
  // inside the bar's own 32px has to be at its weakest at the lower edge and
  // is therefore weakest a few pixels under the text, which is the half of
  // the letter a bright photograph takes first. Given half the bar again to
  // fade in, the text's row sits in the dark part and the band still ends in
  // the wallpaper rather than against a line.
  //
  // A layer of its own rather than `backgroundImage` on the bar, because a
  // background stops at the box. It takes no pointer: it hangs over the top
  // of the stage, where the windows are, and a click there belongs to the
  // window. `zIndex: -1` puts it under the bar's own text, which `isolation`
  // below keeps from meaning "under the wallpaper".
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
  // White with a shadow under it, in both themes — `foreground` would not
  // do: it flips with the theme, and the wallpaper does not. The scrim
  // darkens the band and the shadow draws each letter off it; a picture
  // bright behind one word and dark behind the next needs both.
  //
  // THE BUTTONS ON THE BAR TAKE IT TOO, through the preflight reset's
  // `color: inherit` on form elements rather than through a rule here — the
  // workspace chips say the same thing on their own side. The theme toggle
  // leans on it hardest: it draws both its icons in `currentcolor` and dims
  // the parked one with a `color-mix` of it, so this one declaration is what
  // puts it in the bar's white rather than in a `foreground` that would go
  // black over a photograph the moment the desk went light.
  color: "white",
  // Three columns, the outer two equal: what is in them can be any width and
  // the middle one stays in the middle of the screen.
  gridTemplateColumns: "1fr auto 1fr",
  insetBlockStart: 0,
  insetInline: 0,
  // What makes the scrim's `zIndex: -1` mean "behind this bar" rather than
  // "behind the page": without a stacking context here, a negative index is
  // resolved against the root, which paints it under the wallpaper — a scrim
  // nobody can see, on a bar that looks exactly like one that has none.
  isolation: "isolate",
  paddingInline: 3,
  position: "absolute",
  textShadow: "textOverPhoto",
});

const startStyles = hstack({ gap: 4 });

const middleStyles = css({ justifySelf: "center" });

const endStyles = hstack({ gap: 3, justify: "flex-end" });

// Not a color of its own: the bar's text is white over a photograph, and
// what marks this out is that it is a word in capitals where the rest of the
// bar is numbers and a clock.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});
