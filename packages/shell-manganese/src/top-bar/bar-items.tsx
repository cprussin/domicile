// The items of manganese's bar. Each reads its bar from context, so a layout
// only names them.

import { ThemeSwitch } from "@domicile-desktop/component-library/ThemeSwitch";

import { css } from "../../styled-system/css";
import { Battery } from "../battery/Battery";
import { Bluetooth } from "../bluetooth/Bluetooth";
import { Brightness } from "../brightness/Brightness";
import { Clock } from "../clock/Clock";
import { LauncherButton } from "../launcher/LauncherButton";
import { Network } from "../network/Network";
import { NotificationBell } from "../notifications/NotificationBell";
import { Sharing } from "../sharing/Sharing";
import { Tray } from "../tray/Tray";
import { Volume } from "../volume/Volume";
import { useBar } from "./bar-context";
import { Workspaces } from "./Workspaces";

/** The launcher button: opens the panel `mod+Space` opens. */
export const BarLauncher = () => {
  const { onOpenLauncher } = useBar();
  return <LauncherButton onOpen={onOpenLauncher} />;
};

/**
 * The tray: application StatusNotifierItems and extension buttons, in one row,
 * in the user's order.
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

/** This screen's workspaces, with the visible one marked. */
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

/** The date and time, to the second. */
export const BarClock = () => <Clock />;

/** The current binding mode, shown only when it is not `default`. */
export const BarMode = () => {
  const { mode } = useBar();
  return mode === "default" ? undefined : (
    <span className={modeStyles}>{mode}</span>
  );
};

/**
 * The theme toggle. Light or dark only: the compositor owns the desktop theme,
 * so there is no system setting above it to follow.
 */
export const BarThemeSelector = () => <ThemeSwitch />;

/** The primary network connection, from the network service. */
export const BarNetwork = () => {
  const { readouts } = useBar();
  return <Network network={readouts.network} />;
};

/** The Bluetooth toggle, from BlueZ. */
export const BarBluetooth = () => {
  const { domicile, readouts } = useBar();
  return <Bluetooth bluetooth={readouts.bluetooth} domicile={domicile} />;
};

/** The volume control, whose panel holds the mixer. */
export const BarVolume = () => {
  const { readouts } = useBar();
  return <Volume audio={readouts.audio} server={readouts.sound} />;
};

/** The screen brightness. */
export const BarBrightness = () => {
  const { readouts } = useBar();
  return <Brightness backlight={readouts.backlight} />;
};

/** The battery charge. */
export const BarBattery = () => {
  const { readouts } = useBar();
  return <Battery battery={readouts.battery} />;
};

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const BarSharing = () => {
  const { domicile } = useBar();
  return <Sharing host={domicile} />;
};

/** The bell, which opens the notification drawer. */
export const BarNotifications = () => {
  const { onOpenNotifications, unread } = useBar();
  return <NotificationBell onOpen={onOpenNotifications} unread={unread} />;
};

// Uses capitals rather than a color, since the bar's text is always white.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});
