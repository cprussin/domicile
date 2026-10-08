import { useDisplays } from "@domicile-desktop/component-library/DisplayProvider";
import { PortalDialogs } from "@domicile-desktop/component-library/PortalDialogs";
import { createToastManager } from "@domicile-desktop/component-library/Toaster";
import { usePictureUrl } from "@domicile-desktop/component-library/usePictureUrl";
import { usePortalWallpaper } from "@domicile-desktop/component-library/usePortalWallpaper";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { previewFile } from "@domicile-desktop/sdk/file-preview";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { ownedChords } from "@domicile-desktop/sdk/own-keybindings";
import { system } from "@domicile-desktop/sdk/system";
import { useCallback, useMemo, useState } from "react";

import { Clipboard } from "./clipboard/Clipboard";
import { useClipboard } from "./clipboard/useClipboard";
import { popupShown } from "./extensions/shown";
import { useExtensions } from "./extensions/useExtensions";
import { useKeybindings } from "./keyboard/useKeybindings";
import { useModifiers } from "./keyboard/useModifiers";
import { appSearch } from "./launcher/app-search";
import type { ApplicationsConfig } from "./launcher/applications-config";
import { Launcher } from "./launcher/Launcher";
import { LaunchKind } from "./launcher/launch";
import { OpenWith } from "./launcher/OpenWith";
import { useOpeningApps } from "./launcher/useOpeningApps";
import { Lock } from "./lock/Lock";
import { LockReadouts } from "./lock/LockReadouts";
import { useLocked } from "./lock/useLocked";
import { NotificationDrawer } from "./notifications/NotificationDrawer";
import { NotificationToasts } from "./notifications/NotificationToasts";
import { useNotifications } from "./notifications/useNotifications";
import { useNow } from "./notifications/useNow";
import { readouts as deskReadouts } from "./readouts/readouts";
import { Monitor } from "./screens/Monitor";
import { NoScreens } from "./screens/NoScreens";
import type { StageScreen } from "./screens/stage-screens";
import { stageScreensOf } from "./screens/stage-screens";
import { useScreenFollowsPointer } from "./screens/useScreenFollowsPointer";
import type { TopBarLayout } from "./top-bar/layout";
import { showsSharing } from "./top-bar/shows-sharing";
import { trayEntries } from "./tray/tray-entry";
import { useTray } from "./tray/useTray";
import { useTrayOrder } from "./tray/useTrayOrder";
import { Wallpaper } from "./wallpaper/Wallpaper";
import type { Focus } from "./window-management/pointer-warp";
import { Stage } from "./window-management/Stage";
import { AimKind } from "./window-management/tiled/aim";
import { usePointerWarp } from "./window-management/usePointerWarp";
import { useWindows } from "./window-management/useWindows";
import { screenOfApp, WindowAction } from "./window-management/window-state";

type Props = {
  /** What the launcher offers beside files. */
  applications: ApplicationsConfig;
  domicile: DomicileHost;
  /** The keys this desktop binds, merged under the config's. */
  keybindings: ShellKeybindings;
  /** The layout of every monitor's bar. */
  topBar: TopBarLayout;
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
  domicile,
  keybindings,
  topBar,
}: Props) => {
  const displays = useDisplays();
  const windows = useWindows(domicile, displays);
  const { act } = windows;

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
    () => appSearch(system(domicile), applications),
    [applications, domicile],
  );
  // Read while the launcher is closed so its rows render with it rather than
  // a moment later.
  const opening = useOpeningApps(apps.opening, windows.launcherOpen);
  // The file the launcher asked what to open with, while that is asked.
  const [openingWith, setOpeningWith] = useState<string | undefined>();
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

  // The battery, backlight, sound, network and Bluetooth. Each library's
  // watch runs once for every bar and the lock screen.
  const readouts = useMemo(() => deskReadouts(domicile), [domicile]);

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
  // The screen whose bell opened the drawer, or `undefined` when closed.
  // Opening it marks everything read and closes all toasts, which the drawer
  // already shows.
  const [notificationsOn, setNotificationsOn] = useState<string | undefined>(
    undefined,
  );
  const notificationsOpen = notificationsOn !== undefined;
  const openNotifications = useCallback(
    (screen: string) => {
      setNotificationsOn(screen);
      read();
      toasts.close();
    },
    [read, toasts],
  );

  // Lock state belongs to the compositor, which is what blocks input. The page
  // cannot set it, and reloading the page does not unlock the desk.
  const lock = useLocked(domicile);

  const screens = useMemo(
    () => stageScreensOf(windows, displays ?? []),
    [displays, windows],
  );

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
  const { pointing } = usePointerWarp({
    domicile,
    focus,
    pressed: windows.pressed,
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
    <>
      {/*
        First, so it paints under everything. It does not wait for the
        desktop to connect.
      */}
      <Wallpaper picture={backgroundPicture} />
      {/*
        Every display the desktop has taken up. A new display appears one
        render after the host reports it, once the reducer gives it a
        workspace.
      */}
      {screens.map(({ geometry: { name } }) => (
        <Monitor
          act={act}
          domicile={domicile}
          extensions={extensions}
          key={name}
          name={name}
          notifications={{
            onOpen: () => {
              openNotifications(name);
            },
            unread: notifications.unread,
          }}
          onOpenExtension={(extension) => {
            setOpened((now) =>
              extension === undefined
                ? closedOn(now, name)
                : { extension, screen: name },
            );
          }}
          opened={opened?.screen === name ? opened.extension : undefined}
          readouts={readouts}
          topBar={topBar}
          tray={tray}
          trayOrder={trayOrder}
          windows={windows}
        />
      ))}
      {/*
        Every window, once for the desk and after every bar, so a window wins a
        tie with a bar it overlaps; see `Stage`.
      */}
      {screens.length > 0 && (
        <Stage
          activeId={windows.activeId}
          // While a desktop panel is open the page keeps the keyboard; see
          // `AppWindow`. Extension popups count.
          behindPanel={
            windows.launcherOpen ||
            windows.clipboardOpen ||
            popupOpen ||
            notificationsOpen
          }
          domicile={domicile}
          draggingId={windows.draggingId}
          focusedId={windows.focusedId}
          modifiers={modifiers}
          onClose={(id) => {
            act(WindowAction.WindowClosed(id));
          }}
          onDrop={() => {
            act(WindowAction.WindowDropped());
          }}
          onDropOn={(id, aim) => {
            switch (aim.kind) {
              case AimKind.Screen: {
                act(WindowAction.WindowDroppedOnScreen(id, aim.name));
                break;
              }
              case AimKind.Window: {
                act(WindowAction.WindowDroppedOn(id, aim.id, aim.edge));
                break;
              }
            }
          }}
          onFullscreen={(id) => {
            act(WindowAction.WindowFullscreened(id));
          }}
          onGrab={(id) => {
            act(WindowAction.WindowGrabbed(id));
          }}
          // Only when the pointer actually moved. A window sliding under a
          // still pointer also fires `pointerover`, and following it would
          // steal focus. See `usePointerWarp`.
          onHover={(id, at) => {
            if (pointing(at)) {
              act(WindowAction.WindowHovered(id));
            }
          }}
          // In page pixels, so a float can be dragged to another screen; see
          // `floatDragged`.
          onMove={(id, x, y) => {
            act(WindowAction.WindowMoved(id, x, y));
          }}
          // Converted to the float's screen's pixels.
          onResize={(id, box, on) => {
            act(
              WindowAction.WindowResized(id, {
                ...box,
                x: box.x - on.screen.x,
                y: box.y - on.screen.y,
              }),
            );
          }}
          onSelect={(id) => {
            act(WindowAction.WindowSelected(id));
          }}
          // The tiling is laid out in the screen's workspace box, so a dragged
          // pixel is a share of that.
          onStretch={(id, edge, by, on) => {
            act(WindowAction.WindowStretched(id, edge, by, on.workspace));
          }}
          popups={windows.popups}
          screens={screens}
          windows={windows.windows}
        />
      )}
      {/* Panels cover the whole desktop, not one screen. */}
      <Launcher
        onDismiss={() => {
          act(WindowAction.LauncherDismissed());
        }}
        onLaunch={(launch) => {
          switch (launch.kind) {
            case LaunchKind.Ran: {
              act(WindowAction.AppLaunched(launch.command));
              break;
            }
            case LaunchKind.Opened: {
              act(WindowAction.FileOpened(launch.path));
              break;
            }
            case LaunchKind.OpenedWith: {
              act(WindowAction.LauncherDismissed());
              setOpeningWith(launch.path);
              break;
            }
            case LaunchKind.Browsed: {
              act(WindowAction.BrowserOpened(launch.url));
              break;
            }
          }
        }}
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
        onCopy={(entry) => {
          domicile.copyClipboardEntry(entry);
        }}
        onDismiss={() => {
          act(WindowAction.ClipboardDismissed());
        }}
        open={windows.clipboardOpen}
        screen={windows.focused}
      />
      {/*
        Over the windows and under every panel, so a toast never covers the
        launcher. Hidden while locked so notifications are not shown on the
        lock screen.
      */}
      <NotificationToasts
        manager={toasts}
        now={now}
        onAction={notifications.invoke}
        shown={!lock.locked}
      />
      {/* Over the whole desktop, like the clipboard. */}
      <NotificationDrawer
        items={notifications.items}
        now={now}
        onAction={notifications.invoke}
        onDismiss={notifications.dismiss}
        // Only a bell opens it, so the drawer reports only closing.
        onOpenChange={(open) => {
          if (!open) {
            setNotificationsOn(undefined);
          }
        }}
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
        omitScreenCasts={showsSharing(topBar)}
        screen={windows.focused}
        screenOf={(appId) => screenOfApp(windows, appId)}
        shellChords={shellChords}
      />
      {/*
        Last, over every panel, so the modal launcher and clipboard cannot take
        input on a locked desk.

        Input is already blocked by the compositor; only the compositor
        unlocks. See `lock/Lock.tsx`.
      */}
      <Lock
        checking={lock.checking}
        locked={lock.locked}
        onUnlock={lock.unlock}
        picture={lockPicture}
        refusals={lock.refusals}
        screen={windows.focused}
      >
        <LockReadouts readouts={readouts} />
      </Lock>
      <NoScreens />
    </>
  );
};

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

/** The open popup, after bar `screen` closes its own. */
const closedOn = (
  opened: { extension: string; screen: string } | undefined,
  screen: string,
): { extension: string; screen: string } | undefined =>
  opened?.screen === screen ? undefined : opened;
