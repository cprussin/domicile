import { useDisplays } from "@domicile-desktop/component-library/DisplayProvider";
import { PortalDialogs } from "@domicile-desktop/component-library/PortalDialogs";
import { useTheme } from "@domicile-desktop/component-library/ThemeProvider";
import { createToastManager } from "@domicile-desktop/component-library/Toaster";
import { usePictureUrl } from "@domicile-desktop/component-library/usePictureUrl";
import { usePortalWallpaper } from "@domicile-desktop/component-library/usePortalWallpaper";
import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import { popupShown } from "@domicile-desktop/manganese-bar-module-tray/extensions/shown";
import { useExtensions } from "@domicile-desktop/manganese-bar-module-tray/extensions/useExtensions";
import type { TrayState } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { TrayContext } from "@domicile-desktop/manganese-bar-module-tray/tray-context";
import { trayEntries } from "@domicile-desktop/manganese-bar-module-tray/tray-entry";
import { useTray } from "@domicile-desktop/manganese-bar-module-tray/useTray";
import { useTrayOrder } from "@domicile-desktop/manganese-bar-module-tray/useTrayOrder";
import { Clipboard } from "@domicile-desktop/manganese-clipboard/Clipboard";
import { useClipboard } from "@domicile-desktop/manganese-clipboard/useClipboard";
import { DomicileContext } from "@domicile-desktop/manganese-host/domicile-context";
import { sharedIconTheme } from "@domicile-desktop/manganese-host/followed-icon-theme";
import { appSearch } from "@domicile-desktop/manganese-launcher/app-search";
import type { ApplicationsConfig } from "@domicile-desktop/manganese-launcher/applications-config";
import { Launcher } from "@domicile-desktop/manganese-launcher/Launcher";
import type { Launch } from "@domicile-desktop/manganese-launcher/launch";
import { LaunchKind } from "@domicile-desktop/manganese-launcher/launch";
import type { LauncherControl } from "@domicile-desktop/manganese-launcher/launcher-context";
import { LauncherContext } from "@domicile-desktop/manganese-launcher/launcher-context";
import { OpenWith } from "@domicile-desktop/manganese-launcher/OpenWith";
import { useOpeningApps } from "@domicile-desktop/manganese-launcher/useOpeningApps";
import { Lock } from "@domicile-desktop/manganese-lock/Lock";
import { LockBar } from "@domicile-desktop/manganese-lock/LockBar";
import { useLocked } from "@domicile-desktop/manganese-lock/useLocked";
import { NotificationDrawer } from "@domicile-desktop/manganese-notifications/NotificationDrawer";
import { NotificationToasts } from "@domicile-desktop/manganese-notifications/NotificationToasts";
import type { NotificationsDrawer } from "@domicile-desktop/manganese-notifications/notifications-context";
import { NotificationsContext } from "@domicile-desktop/manganese-notifications/notifications-context";
import { useNotifications } from "@domicile-desktop/manganese-notifications/useNotifications";
import { useNow } from "@domicile-desktop/manganese-notifications/useNow";
import { Wallpaper } from "@domicile-desktop/manganese-wallpaper/Wallpaper";
import { desktopClientIcons } from "@domicile-desktop/manganese-window-management/client-icons";
import type { Direction } from "@domicile-desktop/manganese-window-management/direction";
import type { FloatingRules } from "@domicile-desktop/manganese-window-management/floating/floating-rules";
import { useKeybindings } from "@domicile-desktop/manganese-window-management/keyboard/useKeybindings";
import { useModifiers } from "@domicile-desktop/manganese-window-management/keyboard/useModifiers";
import type { Geometry } from "@domicile-desktop/manganese-window-management/placement";
import type {
  Focus,
  Spot,
} from "@domicile-desktop/manganese-window-management/pointer-warp";
import type { Rect } from "@domicile-desktop/manganese-window-management/rect";
import { Stage } from "@domicile-desktop/manganese-window-management/Stage";
import { shownWindowsOf } from "@domicile-desktop/manganese-window-management/screens/shown-windows";
import type { StageScreen } from "@domicile-desktop/manganese-window-management/screens/stage-screens";
import { useScreenFollowsPointer } from "@domicile-desktop/manganese-window-management/screens/useScreenFollowsPointer";
import { useShared } from "@domicile-desktop/manganese-window-management/screens/useShared";
import { useStageScreens } from "@domicile-desktop/manganese-window-management/screens/useStageScreens";
import type { Aim } from "@domicile-desktop/manganese-window-management/tiled/aim";
import { AimKind } from "@domicile-desktop/manganese-window-management/tiled/aim";
import type { NodeRef } from "@domicile-desktop/manganese-window-management/tree/path";
import { useClientIcons } from "@domicile-desktop/manganese-window-management/useClientIcons";
import { usePointerWarp } from "@domicile-desktop/manganese-window-management/usePointerWarp";
import { useWindows } from "@domicile-desktop/manganese-window-management/useWindows";
import { WindowKind } from "@domicile-desktop/manganese-window-management/window";
import {
  activeIsPrivate,
  screenOfApp,
  WindowAction,
} from "@domicile-desktop/manganese-window-management/window-state";
import type { Workspaces } from "@domicile-desktop/manganese-window-management/workspaces-context";
import { WorkspacesContext } from "@domicile-desktop/manganese-window-management/workspaces-context";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { previewFile } from "@domicile-desktop/sdk/file-preview";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { ownedChords } from "@domicile-desktop/sdk/own-keybindings";
import { system } from "@domicile-desktop/sdk/system";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { LOCK_BAR } from "./default-bars";
import { Monitor } from "./screens/Monitor";
import { NoScreens } from "./screens/NoScreens";
import { showsSharing } from "./shows-sharing";

type Props = {
  /** What the launcher offers beside files. */
  applications: ApplicationsConfig;
  /** The layout of every monitor's bar. */
  bar: BarLayout;
  domicile: DomicileHost;
  /** Which client windows open floating, besides dialogs. */
  floating: FloatingRules;
  /** The keys this desktop binds, merged under the config's. */
  keybindings: ShellKeybindings;
};

/**
 * The desktop: a bar on every monitor, the windows of each monitor's
 * workspace, and the panels over them.
 *
 * One page spans every monitor. It renders a {@link Monitor} per display and
 * one {@link Stage} that draws every window. Workspaces are shared across
 * monitors, as in sway. See `docs/architecture/ONE-PAGE-FOR-THE-DESK.md`.
 */
export const Desktop = ({
  applications,
  bar,
  domicile,
  floating,
  keybindings,
}: Props) => {
  const displays = useDisplays();
  // The wallpaper advances only this theme's rotation, and holds it while
  // the theme wipe plays.
  const { flipping, theme } = useTheme();
  const windows = useWindows(domicile, displays, floating);
  const { act } = windows;
  const clientIcons = useClientIcons(
    domicile,
    windows.windows.flatMap((window) =>
      window.kind === WindowKind.App ? [window.desktopId] : [],
    ),
    desktopClientIcons,
  );

  // Super returns the pointer to the page; Shift turns a drag into a resize.
  // Read from this page's key events and from the engine's report for browser
  // windows, whose keys this page never sees.
  const { modifiers, spendShift } = useModifiers(domicile);

  // The compositor indexes the home directory and returns matches; the page
  // has no filesystem. Memoized because a new function would restart the
  // search.
  const search = useCallback(
    (query: string) => domicile.searchFiles(query),
    [domicile],
  );
  // The pictures applications set through the Wallpaper portal. Memoized
  // because a new `system` would read them again.
  const files = useMemo(() => system(domicile), [domicile]);
  const portalWallpaper = usePortalWallpaper(domicile);
  const backgroundPicture = usePictureUrl(files, portalWallpaper.background);
  const lockPicture = usePictureUrl(files, portalWallpaper.lockscreen);
  // Installed apps and bookmarks, read through the desktop's system calls.
  // Memoized because it holds what was read and the bookmarks' icons.
  const apps = useMemo(
    () => appSearch(system(domicile), applications, sharedIconTheme(domicile)),
    [applications, domicile],
  );
  // Read while the launcher is closed so its rows render with it rather than
  // a moment later.
  const opening = useOpeningApps(apps.opening, windows.launcherOpen);
  // The file the launcher asked what to open with, while that is asked.
  const [openingWith, setOpeningWith] = useState<string | undefined>();
  // The launcher's pick, held until it has closed and the screen shows it
  // gone, so nothing it opens sees it. A screenshot app would shoot it.
  const [picked, setPicked] = useState<Launch | undefined>();
  // File previews, read through the desktop's system calls.
  const preview = useCallback(
    (path: string) => previewFile(system(domicile), path),
    [domicile],
  );

  // Clipboard history is pushed by the compositor, so it is ready before the
  // panel opens.
  const clipboard = useClipboard(domicile);

  // Subscribed once for the desk, not per bar: there is a bar per monitor.
  const extensions = useExtensions(domicile);

  // Tray icons, subscribed once for the desk.
  const tray = useTray(domicile);
  // Tray order is shared so a drag on one bar reorders every bar.
  const trayOrder = useTrayOrder(
    trayEntries(tray, extensions, []).map(({ key }) => key),
  );

  // Notifications, subscribed once for the desk. One toast manager for the
  // page's life, because the toaster subscribes to it once.
  const [toasts] = useState(createToastManager);
  const notifications = useNotifications(domicile, toasts);
  const { read } = notifications;
  const now = useNow();
  // The screen whose bell last opened the drawer. Kept after it closes, so the
  // drawer slides out on that screen. Opening it marks everything read and
  // closes all toasts, which the drawer already shows.
  const [notificationsOn, setNotificationsOn] = useState<string | undefined>(
    undefined,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openNotifications = useCallback(
    (screen: string) => {
      setNotificationsOn(screen);
      setNotificationsOpen(true);
      read();
      toasts.close();
    },
    [read, toasts],
  );

  // Lock state belongs to the compositor, which is what blocks input. The page
  // cannot set it, and reloading the page does not unlock the desk.
  const lock = useLocked(domicile);

  const screens = useStageScreens(windows, displays);

  // The pointer follows the keyboard. Focus follows the pointer, so otherwise
  // the next pointer event would undo a keyboard focus change. See
  // `pointer-warp.ts`.
  const focus = useMemo(
    () => focusOf(screens, windows.focused, windows.activeId),
    [screens, windows.activeId, windows.focused],
  );
  const open = useMemo(
    () => windows.windows.map(({ id }) => id),
    [windows.windows],
  );
  // Bars count: a window is under the pointer from its title bar down.
  const shown = useMemo(
    () =>
      screens.flatMap(({ screenful }) =>
        screenful.placements.map(({ frame, id }) => ({ box: frame, id })),
      ),
    [screens],
  );
  const { pointing } = usePointerWarp({
    domicile,
    focus,
    pressed: windows.pressed,
    shown,
    windows: open,
  });

  // The open extension popup and the bar it belongs to.
  const [opened, setOpened] = useState<
    { extension: string; screen: string } | undefined
  >(undefined);
  // Cleared once the tray stops showing it, so a later `action.enable()` does
  // not reopen it. Set during render (React's pattern for derived state) so no
  // frame shows the stale popup.
  const popupOpen = popupShown(extensions, opened?.extension);
  if (opened !== undefined && !popupOpen) {
    setOpened(undefined);
  }
  const openExtension = useCallback(
    (screen: string, extension: string | undefined) => {
      setOpened((now) =>
        extension === undefined ? closedOn(now, screen) : { extension, screen },
      );
    },
    [],
  );

  // Shift is spent whether or not a window was floated: the user pressed it
  // for the chord, so it should not carry over to the next window. Both the
  // page's keydown and the compositor's forwarded chords come through here.
  const onAction = useCallback(
    (action: WindowAction) => {
      spendShift();
      act(action);
      // Moves the pointer with the keyboard; see `usePointerWarp`. Dispatched
      // in the same turn so both land in one render.
      act(WindowAction.KeyPressed());
    },
    [act, spendShift],
  );

  // Memoized so the stage redraws only when what it shows changes.
  const stageActions = useMemo(
    () => stageActionsOf(act, pointing),
    [act, pointing],
  );

  // The panels' callbacks and the lock screen's bar, memoized so a panel
  // redraws only when what it shows changes.
  const launcherClosed = useCallback(() => {
    if (picked !== undefined) {
      setPicked(undefined);
      afterAFramePainted(() => {
        launch(picked, act, setOpeningWith);
      });
    }
  }, [act, picked]);
  const launcherDismissed = useCallback(() => {
    act(WindowAction.LauncherDismissed());
  }, [act]);
  const launched = useCallback(
    (pick: Launch) => {
      setPicked(pick);
      act(WindowAction.LauncherDismissed());
    },
    [act],
  );
  const copied = useCallback(
    (entry: number) => {
      domicile.copyClipboardEntry(entry);
    },
    [domicile],
  );
  const clipboardDismissed = useCallback(() => {
    act(WindowAction.ClipboardDismissed());
  }, [act]);
  // Only a bell opens the drawer, so it reports only closing.
  const drawerToggled = useCallback((open: boolean) => {
    if (!open) {
      setNotificationsOpen(false);
    }
  }, []);
  const { screens: deskScreens, workspaces } = windows;
  const screenOf = useCallback(
    (appId: string) => screenOfApp({ screens: deskScreens, workspaces }, appId),
    [deskScreens, workspaces],
  );
  // Frames with their bars; the page's own boxes leave those out and still
  // count a hidden tab.
  const shownWindows = useCallback(() => shownWindowsOf(screens), [screens]);
  // What the bars' items read. Each is its own context, so an item redraws
  // only when what it reads changes.
  const launcherControl = useMemo(
    () => ({
      toggle: () => {
        act(WindowAction.LauncherToggled());
      },
    }),
    [act],
  );
  const drawer = useMemo(
    () => ({ open: openNotifications, unread: notifications.unread }),
    [notifications.unread, openNotifications],
  );
  const trayState = useMemo(
    () => ({
      extensions,
      items: tray,
      open: openExtension,
      opened,
      order: trayOrder,
    }),
    [extensions, opened, openExtension, tray, trayOrder],
  );
  // Kept while each screen shows the same workspace, though `screens` changes
  // with every window.
  const current = useShared(
    Object.fromEntries(
      screens.map((shown) => [shown.geometry.name, shown.current]),
    ),
  );
  const shownWorkspaces = useMemo(
    () => ({
      current,
      focused: windows.focused,
      homes: windows.homes,
      mode: windows.mode,
      select: (workspace: string) => {
        act(WindowAction.WorkspaceSelected(workspace));
      },
    }),
    [act, current, windows.focused, windows.homes, windows.mode],
  );

  // A global shortcuts review flags these.
  const shellChords = useMemo(() => ownedChords(keybindings), [keybindings]);

  // The binding mode is desk-wide.
  useKeybindings({
    domicile,
    keybindings,
    launcherOpen: windows.launcherOpen,
    mode: windows.mode,
    onAction,
    onModeChanged: (mode) => {
      act(WindowAction.ModeSet(mode));
    },
  });

  useScreenFollowsPointer({ act, displays, focused: windows.focused });

  return (
    <BarProviders
      domicile={domicile}
      drawer={drawer}
      launcher={launcherControl}
      tray={trayState}
      workspaces={shownWorkspaces}
    >
      {/*
        First, so it paints under everything. It does not wait for the
        desktop to connect.
      */}
      <Wallpaper held={flipping} picture={backgroundPicture} theme={theme} />
      {/*
        Every display the desktop has taken up. A new display appears one
        render after the host reports it, once the reducer gives it a
        workspace.
      */}
      {screens.map(({ geometry: { name } }) => (
        <Monitor bar={bar} key={name} name={name} />
      ))}
      {/*
        Every window, once for the desk and after every bar, so a window wins a
        tie with a bar it overlaps; see `Stage`.
      */}
      {screens.length > 0 && (
        <Stage
          activeId={windows.activeId}
          behindPanel={
            windows.launcherOpen ||
            windows.clipboardOpen ||
            popupOpen ||
            notificationsOpen ||
            lock.locked
          }
          // While a desktop panel is open the page keeps the keyboard; see
          // `AppWindow`. Extension popups and the lock screen count.
          clientIcons={clientIcons}
          domicile={domicile}
          draggingId={windows.draggingId}
          focusedId={windows.focusedId}
          modifiers={modifiers}
          {...stageActions}
          popups={windows.popups}
          scratchpad={windows.scratchpad}
          screens={screens}
          windows={windows.windows}
        />
      )}
      {/* Panels cover the whole desktop, not one screen. */}
      <Launcher
        fromPrivate={activeIsPrivate(windows)}
        onClosed={launcherClosed}
        onDismiss={launcherDismissed}
        onLaunch={launched}
        open={windows.launcherOpen}
        opening={opening}
        preview={preview}
        screen={windows.focused}
        search={search}
        searchApps={apps.search}
      />
      {openingWith !== undefined && (
        <OpenWith
          onClose={() => {
            setOpeningWith(undefined);
          }}
          onOpen={(argv) => {
            setOpeningWith(undefined);
            act(WindowAction.AppLaunched(argv));
          }}
          path={openingWith}
          screen={windows.focused}
          system={files}
        />
      )}
      {/* Over the whole desktop, like the launcher. */}
      <Clipboard
        entries={clipboard}
        onCopy={copied}
        onDismiss={clipboardDismissed}
        open={windows.clipboardOpen}
        screen={windows.focused}
      />
      {/*
        Over the windows and under every panel, so a toast never covers the
        launcher. On the screen with the keyboard. Hidden while locked so
        notifications are not shown on the lock screen.
      */}
      <NotificationToasts
        manager={toasts}
        now={now}
        onAction={notifications.invoke}
        onReply={notifications.reply}
        screen={windows.focused}
        shown={!lock.locked}
      />
      {/* Over the whole desktop, like the clipboard. */}
      <NotificationDrawer
        items={notifications.items}
        now={now}
        onAction={notifications.invoke}
        onDismiss={notifications.dismiss}
        onOpenChange={drawerToggled}
        onReply={notifications.reply}
        open={notificationsOpen && !lock.locked}
        screen={notificationsOn}
      />
      {/*
        Applications' dialogs, over every panel, on the screen of the window
        that asked. A dialog with no parent window goes on the focused screen.
        Screen casts show in the bar's sharing item when it has one.
      */}
      <PortalDialogs
        host={domicile}
        omitScreenCasts={showsSharing(bar)}
        screen={windows.focused}
        screenOf={screenOf}
        shellChords={shellChords}
        shownWindows={shownWindows}
      />
      {/*
        Last, over every panel, so the modal launcher and clipboard cannot take
        input on a locked desk.

        Input is already blocked by the compositor; only the compositor
        unlocks. See `lock/Lock.tsx`.
      */}
      <Lock
        bar={lockBar}
        checking={lock.checking}
        locked={lock.locked}
        onUnlock={lock.unlock}
        picture={lockPicture}
        refusals={lock.refusals}
        refused={lock.refused}
        screen={windows.focused}
      />
      <NoScreens />
    </BarProviders>
  );
};

/** The lock screen's bar on monitor `screen`. */
const lockBar = (screen: string) => (
  <LockBar layout={LOCK_BAR} screen={screen} />
);

/** Everything the bars' items read, desktop-wide. */
const BarProviders = ({
  children,
  domicile,
  drawer,
  launcher,
  tray,
  workspaces,
}: {
  children: ReactNode;
  domicile: DomicileHost;
  drawer: NotificationsDrawer;
  launcher: LauncherControl;
  tray: TrayState;
  workspaces: Workspaces;
}) => (
  <DomicileContext value={domicile}>
    <WorkspacesContext value={workspaces}>
      <LauncherContext value={launcher}>
        <NotificationsContext value={drawer}>
          <TrayContext value={tray}>{children}</TrayContext>
        </NotificationsContext>
      </LauncherContext>
    </WorkspacesContext>
  </DomicileContext>
);

/**
 * The focused window's contents box, or the whole screen when it has no
 * focused window.
 *
 * The pointer must be inside this box to keep focus: `pointerover` on the
 * `<app>` element moves focus (see `Stage`), so the bar does not count. A
 * window hidden behind a tab has only its bar. An empty screen uses its
 * center, as sway does.
 *
 * `undefined` while the keyboard is on no screen the desktop has taken up.
 */
const focusOf = (
  screens: readonly StageScreen[],
  focused: string,
  activeId: string | undefined,
): Focus | undefined => {
  const screen = screens.find(({ geometry }) => geometry.name === focused);
  const placement = screen?.screenful.placements.find(
    ({ id }) => id === activeId,
  );
  if (screen === undefined) {
    return undefined;
  } else if (activeId === undefined) {
    return { box: screen.geometry.screen, id: undefined };
  } else if (placement === undefined) {
    throw new Error(`shell: window ${activeId} is not laid out on its screen`);
  } else {
    return { box: placement.surface ?? placement.bar, id: placement.id };
  }
};

/**
 * Runs `then` once a frame drawn after now has been painted: the second
 * animation frame from now runs after the first one's paint.
 */
const afterAFramePainted = (then: () => void) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(then);
  });
};

/** Does what the launcher picked, once it has closed. */
const launch = (
  picked: Launch,
  act: (action: WindowAction) => void,
  openWith: (path: string) => void,
) => {
  switch (picked.kind) {
    case LaunchKind.Ran: {
      act(WindowAction.AppLaunched(picked.command));
      break;
    }
    case LaunchKind.Opened: {
      act(WindowAction.FileOpened(picked.path));
      break;
    }
    case LaunchKind.OpenedWith: {
      openWith(picked.path);
      break;
    }
    case LaunchKind.Browsed: {
      act(WindowAction.BrowserOpened(picked.url, picked.isPrivate));
      break;
    }
  }
};

/** The open popup, after bar `screen` closes its own. */
const closedOn = (
  opened: { extension: string; screen: string } | undefined,
  screen: string,
): { extension: string; screen: string } | undefined =>
  opened?.screen === screen ? undefined : opened;

/**
 * What each window's chrome does, as `Stage` takes it: every action goes
 * through `act`.
 *
 * @param pointing - whether a pointer event is the user's; see
 *   `usePointerWarp`.
 */
const stageActionsOf = (
  act: (action: WindowAction) => void,
  pointing: (at: Spot) => boolean,
) => ({
  onClose: (id: string) => {
    act(WindowAction.WindowClosed(id));
  },
  onDismiss: (id: string) => {
    act(WindowAction.ScratchpadDismissed(id));
  },
  onDrop: () => {
    act(WindowAction.WindowDropped());
  },
  onDropOn: (id: string, aim: Aim) => {
    switch (aim.kind) {
      case AimKind.Screen: {
        act(WindowAction.WindowDroppedOnScreen(id, aim.name));
        break;
      }
      case AimKind.Group: {
        act(WindowAction.WindowDroppedOn(id, { id: aim.id, up: 1 }, aim.edge));
        break;
      }
      case AimKind.Strip:
      case AimKind.Window: {
        act(WindowAction.WindowDroppedOn(id, { id: aim.id, up: 0 }, aim.edge));
        break;
      }
    }
  },
  onFloat: (id: string) => {
    act(WindowAction.WindowFloated(id));
  },
  onFullscreen: (id: string) => {
    act(WindowAction.WindowFullscreened(id));
  },
  onGrab: (id: string) => {
    act(WindowAction.WindowGrabbed(id));
  },
  onGroupDropOn: (group: NodeRef, aim: Aim) => {
    switch (aim.kind) {
      case AimKind.Group: {
        act(
          WindowAction.GroupDroppedOn(group, { id: aim.id, up: 1 }, aim.edge),
        );
        break;
      }
      case AimKind.Screen: {
        act(WindowAction.GroupDroppedOnScreen(group, aim.name));
        break;
      }
      case AimKind.Strip: {
        // `aimAt` aims only a single dragged tab along its strip.
        throw new Error(`desktop: group ${group.id} aimed along a strip`);
      }
      case AimKind.Window: {
        act(
          WindowAction.GroupDroppedOn(group, { id: aim.id, up: 0 }, aim.edge),
        );
        break;
      }
    }
  },
  onGroupFloat: (group: NodeRef) => {
    act(WindowAction.GroupFloated(group));
  },
  onGroupFullscreen: (group: NodeRef) => {
    act(WindowAction.GroupFullscreened(group));
  },
  onGroupGrab: (group: NodeRef) => {
    act(WindowAction.GroupGrabbed(group));
  },
  // Only when the pointer actually moved. A window sliding under a still
  // pointer also fires `pointerover`, and following it would steal focus. See
  // `usePointerWarp`.
  onHover: (id: string, at: Spot) => {
    if (pointing(at)) {
      act(WindowAction.WindowHovered(id));
    }
  },
  onIcon: (window: string, icon: string) => {
    act(WindowAction.BrowserIconChanged(window, icon));
  },
  // In page pixels, so a float can be dragged to another screen; see
  // `floatDragged`.
  onMove: (id: string, x: number, y: number) => {
    act(WindowAction.WindowMoved(id, x, y));
  },
  onNewTab: (id: string) => {
    act(WindowAction.NewTabPressed(id));
  },
  onPageFullscreen: (id: string, fullscreen: boolean) => {
    act(WindowAction.PageFullscreened(id, fullscreen));
  },
  // Converted to the float's screen's pixels.
  onResize: (id: string, box: Rect, on: Geometry) => {
    act(
      WindowAction.WindowResized(id, {
        ...box,
        x: box.x - on.screen.x,
        y: box.y - on.screen.y,
      }),
    );
  },
  onSelect: (id: string) => {
    act(WindowAction.WindowSelected(id));
  },
  // The tiling is laid out in the screen's workspace box, so a dragged pixel
  // is a share of that.
  onStretch: (id: string, edge: Direction, by: number, on: Geometry) => {
    act(WindowAction.WindowStretched(id, edge, by, on.workspace));
  },
});
