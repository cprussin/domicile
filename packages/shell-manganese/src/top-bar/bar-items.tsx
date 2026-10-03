// The items manganese's bar is made of, each reading the bar it is on rather
// than taking props, so a user's layout names them and nothing else.

import { ThemeSwitch } from "@domicile-desktop/component-library/ThemeSwitch";

import { css } from "../../styled-system/css";
import { Battery } from "../battery/Battery";
import { Brightness } from "../brightness/Brightness";
import { Clock } from "../clock/Clock";
import { LauncherButton } from "../launcher/LauncherButton";
import { NotificationBell } from "../notifications/NotificationBell";
import { Tray } from "../tray/Tray";
import { Volume } from "../volume/Volume";
import { useBar } from "./bar-context";
import { Workspaces } from "./Workspaces";

/**
 * The launcher's button: the panel `mod+Space` opens, for a hand already on
 * the pointer.
 */
export const BarLauncher = () => {
  const { onOpenLauncher } = useBar();
  return <LauncherButton onOpen={onOpenLauncher} />;
};

/**
 * The tray: each icon an application's StatusNotifierItem or an extension's
 * toolbar button, in one row in the order the user dragged them into.
 */
export const BarTray = () => {
  const {
    domicile,
    extensions,
    onOpenExtension,
    openedExtension,
    tray,
    trayOrder,
  } = useBar();
  return (
    <Tray
      domicile={domicile}
      extensions={extensions}
      items={tray}
      onMove={trayOrder.move}
      onOpen={onOpenExtension}
      opened={openedExtension}
      order={trayOrder.order}
    />
  );
};

/** The workspaces this screen has, the one on screen marked. */
export const BarWorkspaces = () => {
  const { current, focused, onSelectWorkspace, workspaces } = useBar();
  return (
    <Workspaces
      current={current}
      focused={focused}
      onSelect={onSelectWorkspace}
      workspaces={workspaces}
    />
  );
};

/** The date and the time, down to the second. */
export const BarClock = () => <Clock />;

/**
 * The binding mode the keys are read in, named only when it is not the usual
 * `default`.
 */
export const BarMode = () => {
  const { mode } = useBar();
  return mode === "default" ? undefined : (
    <span className={modeStyles}>{mode}</span>
  );
};

/**
 * The theme toggle. Two positions rather than three: this bar *is* the
 * system, so there is nothing above it for a `system` to follow.
 */
export const BarThemeSelector = () => <ThemeSwitch />;

/** The speaker, whose panel holds the default output and microphone. */
export const BarVolume = () => {
  const { domicile, screen } = useBar();
  return <Volume domicile={domicile} screen={screen} />;
};

/** The screen's brightness. */
export const BarBrightness = () => {
  const { domicile } = useBar();
  return <Brightness domicile={domicile} />;
};

/** The charge. */
export const BarBattery = () => {
  const { domicile } = useBar();
  return <Battery domicile={domicile} />;
};

/** The bell, which opens the drawer of notifications. */
export const BarNotifications = () => {
  const { onOpenNotifications, unread } = useBar();
  return <NotificationBell onOpen={onOpenNotifications} unread={unread} />;
};

// Not a color of its own: the bar's text is white over a photograph, and
// what marks this out is that it is a word in capitals where the rest of the
// bar is numbers and a clock.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});
