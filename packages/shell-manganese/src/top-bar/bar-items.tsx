// The items of manganese's bar. Each reads its bar from context, so a layout
// only names them.

import { ThemeSwitch } from "@domicile-desktop/component-library/ThemeSwitch";
import { system } from "@domicile-desktop/sdk/system";
import { useMemo } from "react";

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
import { useBar, useBarReadouts } from "./bar-context";
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
  const { current, focused, onSelectWorkspace, urgent, workspaces } = useBar();
  return (
    <Workspaces
      current={current}
      focused={focused}
      onSelect={onSelectWorkspace}
      urgent={urgent}
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

/** The primary network connection, whose panel controls Wi-Fi. */
export const BarNetwork = () => {
  const { domicile, readouts } = useBar();
  return (
    <Network
      domicile={domicile}
      network={readouts.network}
      wifi={readouts.wifi}
    />
  );
};

/**
 * Bluetooth, whose panel controls adapters and devices. Only its state while
 * locked.
 */
export const BarBluetooth = () => {
  const { domicile, locked, readouts } = useBarReadouts();
  return (
    <Bluetooth
      bluetooth={readouts.bluetooth}
      domicile={domicile}
      locked={locked}
    />
  );
};

/**
 * The volume control, whose panel holds the mixer, or only the output while
 * locked.
 */
export const BarVolume = () => {
  const { locked, readouts } = useBarReadouts();
  return (
    <Volume audio={readouts.audio} locked={locked} server={readouts.sound} />
  );
};

/** The screen brightness. */
export const BarBrightness = () => {
  const { readouts } = useBarReadouts();
  return <Brightness backlight={readouts.backlight} />;
};

/** The battery charge. */
export const BarBattery = () => {
  const { readouts } = useBarReadouts();
  return <Battery battery={readouts.battery} />;
};

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const BarSharing = () => {
  const { domicile } = useBar();
  const files = useMemo(() => system(domicile), [domicile]);
  return <Sharing host={domicile} system={files} />;
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
