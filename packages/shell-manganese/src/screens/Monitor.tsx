import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import type { TrayItem } from "@domicile/chrome-sdk/tray";
import { Screen } from "@domicile/component-library/Screen";

import type { TopBarLayout } from "../top-bar/layout";
import { TopBar } from "../top-bar/TopBar";
import type { TrayOrder } from "../tray/useTrayOrder";
import type { Windows } from "../window-management/useWindows";
import {
  currentOn,
  WindowAction,
  workspacesOn,
} from "../window-management/window-state";

/** What a monitor's bar knows of the desk's notifications. */
export type MonitorNotifications = {
  unread: number;
  onOpen: () => void;
};

type Props = {
  /** Run a command: a press on this monitor's chrome. */
  act: (action: WindowAction) => void;
  domicile: DomicileClient;
  /** The extensions with an action, for the tray on this monitor's bar. */
  extensions: readonly Extension[];
  /** Which monitor this is. */
  name: string;
  /**
   * The desk's notifications, as this monitor's bar has them: how many
   * arrived unseen, whether the drawer is open, and how to open it.
   */
  notifications: MonitorNotifications;
  /** The extension whose popup is open under this bar's tray, if any. */
  opened: string | undefined;
  /** An extension's popup opened under this bar's tray, or closed. */
  onOpenExtension: (id: string | undefined) => void;
  /** The system tray's icons, for this monitor's bar. */
  tray: readonly TrayItem[];
  /** The order of this monitor's tray, which is every monitor's. */
  trayOrder: TrayOrder;
  /** What goes on this monitor's bar, which is every monitor's. */
  topBar: TopBarLayout;
  windows: Windows;
};

/**
 * One monitor of the desk: the bar across the top of it.
 *
 * The windows are not here. The page spans the desk, so the `Stage` draws
 * every window once, at its place on the page, whichever monitor it is on.
 */
export const Monitor = ({
  act,
  domicile,
  extensions,
  name,
  notifications,
  onOpenExtension,
  opened,
  topBar,
  tray,
  trayOrder,
  windows,
}: Props) => (
  <Screen name={name}>
    <TopBar
      current={currentOn(windows, name)}
      domicile={domicile}
      extensions={extensions}
      focused={windows.focused === name}
      layout={topBar}
      mode={windows.mode}
      onOpenExtension={onOpenExtension}
      onOpenLauncher={() => {
        act(WindowAction.LauncherToggled());
      }}
      onOpenNotifications={notifications.onOpen}
      onSelectWorkspace={(workspace) => {
        act(WindowAction.WorkspaceSelected(workspace));
      }}
      openedExtension={opened}
      screen={name}
      tray={tray}
      trayOrder={trayOrder}
      unread={notifications.unread}
      workspaces={workspacesOn(windows, name)}
    />
  </Screen>
);
