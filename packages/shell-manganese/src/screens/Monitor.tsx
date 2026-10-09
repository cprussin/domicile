import { Screen } from "@domicile-desktop/component-library/Screen";
import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";

import type { Readouts } from "../readouts/readouts";
import type { TopBarLayout } from "../top-bar/layout";
import { TopBar } from "../top-bar/TopBar";
import type { TrayOrder } from "../tray/useTrayOrder";
import type { Windows } from "../window-management/useWindows";
import {
  currentOn,
  urgentWorkspacesOf,
  WindowAction,
  workspacesOn,
} from "../window-management/window-state";

/** The notification state a monitor's bar needs. */
export type MonitorNotifications = {
  unread: number;
  onOpen: () => void;
};

type Props = {
  /** Run a command for this monitor's chrome. */
  act: (action: WindowAction) => void;
  domicile: DomicileHost;
  /** The extensions with an action, for the tray. */
  extensions: readonly Extension[];
  /** Which monitor this is. */
  name: string;
  /**
   * The notifications as this bar shows them: unseen count, whether the drawer
   * is open, and how to open it.
   */
  notifications: MonitorNotifications;
  /** The extension whose tray popup is open, if any. */
  opened: string | undefined;
  /** Open or close an extension's tray popup. */
  onOpenExtension: (id: string | undefined) => void;
  /** The desk's system readouts, shared by every monitor. */
  readouts: Readouts;
  /** The system tray icons. */
  tray: readonly DomicileTrayItem[];
  /** The tray order, shared by every monitor. */
  trayOrder: TrayOrder;
  /** The bar layout, shared by every monitor. */
  topBar: TopBarLayout;
  windows: Windows;
};

/**
 * One monitor: the bar across its top.
 *
 * Windows are not drawn here. The page spans the whole desktop, so `Stage`
 * draws each window once at its place on the page.
 */
export const Monitor = ({
  act,
  domicile,
  extensions,
  name,
  notifications,
  onOpenExtension,
  opened,
  readouts,
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
      readouts={readouts}
      screen={name}
      tray={tray}
      trayOrder={trayOrder}
      unread={notifications.unread}
      urgent={urgentWorkspacesOf(windows)}
      workspaces={workspacesOn(windows, name)}
    />
  </Screen>
);
