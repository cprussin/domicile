// The items of manganese's bar. Each reads what it shows from context, so a
// layout only names them.

import { ThemeSwitch } from "@domicile-desktop/component-library/ThemeSwitch";
import { system } from "@domicile-desktop/sdk/system";
import { useMemo } from "react";

import { css } from "../../styled-system/css";
import { Battery } from "../battery/Battery";
import { deskBattery } from "../battery/desk-battery";
import { Bluetooth } from "../bluetooth/Bluetooth";
import { deskBluetooth } from "../bluetooth/desk-bluetooth";
import { Brightness } from "../brightness/Brightness";
import { deskBacklight } from "../brightness/desk-backlight";
import { Clock } from "../clock/Clock";
import { useDomicile } from "../host/domicile-context";
import { LauncherButton } from "../launcher/LauncherButton";
import { useLauncher } from "../launcher/launcher-context";
import { deskNetwork } from "../network/desk-network";
import { Network } from "../network/Network";
import { NotificationBell } from "../notifications/NotificationBell";
import { useNotificationsDrawer } from "../notifications/notifications-context";
import { Sharing } from "../sharing/Sharing";
import { Tray } from "../tray/Tray";
import { useTrayState } from "../tray/tray-context";
import { deskSound } from "../volume/desk-sound";
import { Volume } from "../volume/Volume";
import { workspacesOn } from "../window-management/window-state";
import { useWorkspaces } from "../window-management/workspaces-context";
import { useBar } from "./bar-context";
import { Workspaces } from "./Workspaces";

/** The launcher button: opens the panel `mod+Space` opens. */
export const BarLauncher = () => {
  const { toggle } = useLauncher();
  return <LauncherButton onOpen={toggle} />;
};

/**
 * The tray: application StatusNotifierItems and extension buttons, in one row,
 * in the user's order.
 */
export const BarTray = () => {
  const domicile = useDomicile();
  const { screen } = useBar();
  const { extensions, items, open, opened, order } = useTrayState();
  return (
    <Tray
      domicile={domicile}
      extensions={extensions}
      items={items}
      onMove={order.move}
      onOpen={(extension) => {
        open(screen, extension);
      }}
      opened={opened?.screen === screen ? opened.extension : undefined}
      order={order.order}
    />
  );
};

/** This screen's workspaces, with the visible one marked. */
export const BarWorkspaces = () => {
  const { screen } = useBar();
  const { current, focused, homes, select } = useWorkspaces();
  const workspaces = useMemo(
    () => workspacesOn({ homes }, screen),
    [homes, screen],
  );
  return (
    <Workspaces
      current={shownOn(current, screen)}
      focused={focused === screen}
      onSelect={select}
      workspaces={workspaces}
    />
  );
};

/** The date and time, to the second. */
export const BarClock = () => <Clock />;

/** The current binding mode, shown only when it is not `default`. */
export const BarMode = () => {
  const { mode } = useWorkspaces();
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
  const domicile = useDomicile();
  const { network, wifi } = deskNetwork(domicile);
  return <Network domicile={domicile} network={network} wifi={wifi} />;
};

/**
 * Bluetooth, whose panel controls adapters and devices. Only its state while
 * locked.
 */
export const BarBluetooth = () => {
  const domicile = useDomicile();
  const { locked } = useBar();
  return (
    <Bluetooth
      bluetooth={deskBluetooth(domicile)}
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
  const { audio, sound } = deskSound(useDomicile());
  const { locked } = useBar();
  return <Volume audio={audio} locked={locked} server={sound} />;
};

/** The screen brightness. */
export const BarBrightness = () => (
  <Brightness backlight={deskBacklight(useDomicile())} />
);

/** The battery charge. */
export const BarBattery = () => (
  <Battery battery={deskBattery(useDomicile())} />
);

/**
 * Shown while an application records the desktop: who records what, and a
 * button to stop each.
 */
export const BarSharing = () => {
  const domicile = useDomicile();
  const files = useMemo(() => system(domicile), [domicile]);
  return <Sharing host={domicile} system={files} />;
};

/** The bell, which opens the notification drawer. */
export const BarNotifications = () => {
  const { screen } = useBar();
  const { open, unread } = useNotificationsDrawer();
  return (
    <NotificationBell
      onOpen={() => {
        open(screen);
      }}
      unread={unread}
    />
  );
};

// Uses capitals rather than a color, since the bar's text is always white.
const modeStyles = css({
  fontSize: "0.625rem",
  textTransform: "uppercase",
});

/** The workspace `screen` shows. Throws for a screen with none. */
const shownOn = (
  current: Readonly<Record<string, string>>,
  screen: string,
): string => {
  const workspace = current[screen];
  if (workspace === undefined) {
    throw new Error(`manganese: screen ${screen} shows no workspace`);
  } else {
    return workspace;
  }
};
