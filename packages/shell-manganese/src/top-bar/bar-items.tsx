// The items of manganese's bar. Each reads its bar from context, so a layout
// only names them.

import { ThemeSwitch } from "@domicile-desktop/component-library/ThemeSwitch";
import { system } from "@domicile-desktop/sdk/system";
import { soundServer } from "@domicile-desktop/system-audio/sound-server";
import { useMemo } from "react";

import { css } from "../../styled-system/css";
import { Battery } from "../battery/Battery";
import { Bluetooth } from "../bluetooth/Bluetooth";
import { Brightness } from "../brightness/Brightness";
import { Clock } from "../clock/Clock";
import { LauncherButton } from "../launcher/LauncherButton";
import { Network } from "../network/Network";
import { NotificationBell } from "../notifications/NotificationBell";
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

/** The primary network connection, from NetworkManager. */
export const BarNetwork = () => {
  const { domicile } = useBar();
  return <Network domicile={domicile} />;
};

/** The Bluetooth toggle, from BlueZ. */
export const BarBluetooth = () => {
  const { domicile } = useBar();
  return <Bluetooth domicile={domicile} />;
};

/** The volume control, whose panel holds the mixer. */
export const BarVolume = () => {
  const { domicile } = useBar();
  const server = useMemo(() => soundServer(system(domicile)), [domicile]);
  return <Volume server={server} />;
};

/** The screen brightness. */
export const BarBrightness = () => {
  const { domicile } = useBar();
  return <Brightness domicile={domicile} />;
};

/** The battery charge. */
export const BarBattery = () => {
  const { domicile } = useBar();
  return <Battery domicile={domicile} />;
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
