import { Screen } from "@domicile-desktop/component-library/Screen";
import type {
  DomicileHost,
  DomicileTrayItem,
} from "@domicile-desktop/sdk/domicile-host";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { memo, useCallback, useMemo } from "react";

import type { Readouts } from "../readouts/readouts";
import type { TopBarLayout } from "../top-bar/layout";
import { TopBar } from "../top-bar/TopBar";
import type { TrayOrder } from "../tray/useTrayOrder";
import type { WindowState } from "../window-management/window-state";
import { WindowAction, workspacesOn } from "../window-management/window-state";

type Props = {
  /** Run a command for this monitor's chrome. */
  act: (action: WindowAction) => void;
  /** The workspace on this monitor. */
  current: string;
  domicile: DomicileHost;
  /** The extensions with an action, for the tray. */
  extensions: readonly Extension[];
  /** Whether this monitor has keyboard focus. */
  focused: boolean;
  /** The screen each workspace lives on, which picks this bar's workspaces. */
  homes: WindowState["homes"];
  /** The current binding mode. */
  mode: string;
  /** Which monitor this is. */
  name: string;
  /** Open the drawer of notifications on the monitor `screen`. */
  onOpenNotifications: (screen: string) => void;
  /** Open or close an extension's tray popup on the monitor `screen`. */
  onOpenExtension: (screen: string, id: string | undefined) => void;
  /** The extension whose tray popup is open on this monitor, if any. */
  opened: string | undefined;
  /** The desk's system readouts, shared by every monitor. */
  readouts: Readouts;
  /** The system tray icons. */
  tray: readonly DomicileTrayItem[];
  /** The tray order, shared by every monitor. */
  trayOrder: TrayOrder;
  /** The bar layout, shared by every monitor. */
  topBar: TopBarLayout;
  /** How many notifications arrived since the drawer was last opened. */
  unread: number;
};

/**
 * One monitor: the bar across its top.
 *
 * Windows are not drawn here. The page spans the whole desktop, so `Stage`
 * draws each window once at its place on the page.
 *
 * Memoized, with callbacks that take the monitor's name, so a change no bar
 * shows redraws none of them.
 */
export const Monitor = memo(
  ({
    act,
    current,
    domicile,
    extensions,
    focused,
    homes,
    mode,
    name,
    onOpenExtension,
    onOpenNotifications,
    opened,
    readouts,
    topBar,
    tray,
    trayOrder,
    unread,
  }: Props) => {
    const workspaces = useMemo(
      () => workspacesOn({ homes }, name),
      [homes, name],
    );
    const openedExtension = useCallback(
      (extension: string | undefined) => {
        onOpenExtension(name, extension);
      },
      [name, onOpenExtension],
    );
    const openedLauncher = useCallback(() => {
      act(WindowAction.LauncherToggled());
    }, [act]);
    const openedNotifications = useCallback(() => {
      onOpenNotifications(name);
    }, [name, onOpenNotifications]);
    const selectedWorkspace = useCallback(
      (workspace: string) => {
        act(WindowAction.WorkspaceSelected(workspace));
      },
      [act],
    );
    return (
      <Screen name={name}>
        <TopBar
          current={current}
          domicile={domicile}
          extensions={extensions}
          focused={focused}
          layout={topBar}
          mode={mode}
          onOpenExtension={openedExtension}
          onOpenLauncher={openedLauncher}
          onOpenNotifications={openedNotifications}
          onSelectWorkspace={selectedWorkspace}
          openedExtension={opened}
          readouts={readouts}
          screen={name}
          tray={tray}
          trayOrder={trayOrder}
          unread={unread}
          workspaces={workspaces}
        />
      </Screen>
    );
  },
);
