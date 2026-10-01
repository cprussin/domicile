import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { createToastManager } from "@domicile/component-library/Toaster";
import { useCallback, useState } from "react";

import { Clipboard } from "./clipboard/Clipboard";
import { useClipboard } from "./clipboard/useClipboard";
import { useExtensions } from "./extensions/useExtensions";
import { useKeybindings } from "./keyboard/useKeybindings";
import { useModifiers } from "./keyboard/useModifiers";
import { Launcher } from "./launcher/Launcher";
import { LaunchKind } from "./launcher/launch";
import { useOpeningApps } from "./launcher/useOpeningApps";
import { Lock } from "./lock/Lock";
import { useLocked } from "./lock/useLocked";
import { NotificationDrawer } from "./notifications/NotificationDrawer";
import { NotificationToasts } from "./notifications/NotificationToasts";
import { useNotifications } from "./notifications/useNotifications";
import { useNow } from "./notifications/useNow";
import { Monitor } from "./screens/Monitor";
import { NoScreens } from "./screens/NoScreens";
import { useScreenFollowsPointer } from "./screens/useScreenFollowsPointer";
import { useTray } from "./tray/useTray";
import { useTrayOrder } from "./tray/useTrayOrder";
import { Wallpaper } from "./wallpaper/Wallpaper";
import type { DeskChannel } from "./window-management/desk-channel";
import { useWindows } from "./window-management/useWindows";
import {
  WindowAction,
  WindowActionKind,
} from "./window-management/window-state";

type Props = {
  /** The other pages of this desk — see `desk-channel.ts`. */
  desk: DeskChannel;
  domicile: DomicileClient;
};

/**
 * The desktop: a bar across the top of every monitor, the windows of the
 * workspace each one is showing under it, and the panels over all of it.
 *
 * **ONE DESKTOP, DRAWN A MONITOR AT A TIME.** A desk of several monitors is
 * several browser windows — one cannot span two CRTCs — each loading this same
 * shell, so this component runs once per screen and renders a {@link Monitor}
 * for every screen of the desk. `<Screen>` draws the one whose display this
 * page's window covers and leaves the others to the pages that cover them.
 *
 * So the state above the monitors is the desk's and not a screen's: the
 * workspaces span every monitor the way sway's do, a workspace is shown on one
 * screen at a time, and asking for one that is already in view moves the
 * keyboard to the screen showing it rather than taking the work off it. That
 * state has to be the same state on every page, which is `useWindows`'s other
 * half.
 */
export const Desktop = ({ desk, domicile }: Props) => {
  const displays = useDisplays();
  const windows = useWindows(domicile, displays, desk);
  const { act } = windows;

  // Super is what hands the pointer back to the page, and Shift is what makes
  // a drag a resize. Both come off this page's own keyboard events — the
  // desktop is the chrome's window, so the compositor's own answer is these
  // keystrokes handed back short — and off the engine's word for a browser
  // window's page, whose keys this page never hears.
  const { modifiers, spendShift } = useModifiers(domicile);

  // Whether the press that put the launcher up was heard on this page, which
  // is the page its box can be typed into. The engine hands the keys to the
  // monitor the pointer is on, and that need not be the monitor the
  // desktop's focus is on: a key can move the focus to another screen before
  // the pointer — and so the keyboard — follows it there.
  //
  // Forgotten once the panel has finished closing rather than as it starts
  // to: the panel is only drawn while this holds, and one taken away with the
  // press that closed it would never get to transition out.
  const [launchedHere, setLaunchedHere] = useState(false);

  // The launcher's rows are the host's answer to what is in its box: the
  // compositor keeps an index of the home and searches it, and all that
  // crosses into this page is what matched. One function for the life of the
  // client, because a new one would be a new search.
  const search = useCallback(
    (query: string) => domicile.searchFiles(query),
    [domicile],
  );
  // And the applications installed, which the compositor reads from the
  // machine's desktop entries for the same reason: a page has no filesystem.
  const searchApps = useCallback(
    (query: string) => domicile.searchApps(query),
    [domicile],
  );
  // Asked while the panel is shut rather than as it opens, so its empty box's
  // rows are drawn with it instead of landing a moment later and pushing the
  // rest down.
  const opening = useOpeningApps(searchApps, windows.launcherOpen);
  // And its preview, of the same index, for the same reason.
  const preview = useCallback(
    (path: string) => domicile.previewFile(path),
    [domicile],
  );

  // Pushed rather than asked for, which is the other shape: a copy is an event
  // the compositor already hears, so the history is here before the panel is
  // opened rather than fetched when it is.
  const clipboard = useClipboard(domicile);

  // And the extensions' actions, pushed for the same reason. Once for the desk
  // rather than once per bar: `on` is a single slot, and a page that is the
  // whole desktop draws a bar per monitor.
  const extensions = useExtensions(domicile);

  // And the system tray's icons, pushed and held once for the desk for the
  // same reasons.
  const tray = useTray(domicile);
  // And the order the user dragged the tray into, once for the desk so a drag
  // on one monitor's bar is a drag on every one's.
  const trayOrder = useTrayOrder();

  // And the desk's notifications, pushed and held once for the desk for the
  // tray's reasons. The toasts are this page's: one manager for the life of
  // the page, because the toaster subscribes to it once.
  const [toasts] = useState(createToastManager);
  const notifications = useNotifications(domicile, toasts);
  const { read } = notifications;
  const now = useNow();
  // Whether the drawer is out. Opening it is reading everything in it, and
  // takes every toast down: each one is in the drawer, and a deck over the
  // drawer would be the same notifications twice.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const openNotifications = useCallback(() => {
    setNotificationsOpen(true);
    read();
    toasts.close();
  }, [read, toasts]);

  // And whether the desk is locked, which is pushed for a harder reason: it is
  // the compositor's state rather than this page's, because the compositor is
  // what refuses to put a forwarded keystroke into the seat. So there is nothing
  // here to set — a reload of this page does not open the desk, and this hook is
  // told where it stands as the page connects.
  const lock = useLocked(domicile);

  // The Shift of the chord that floats a window is spent whether or not there
  // was a window to float, because what it says is about the press rather than
  // the outcome: the user pressed it to reach the chord, and a Shift the
  // desktop has already answered is not one held over the window that lands.
  // Both paths into here — the page's own keydown and the chord the compositor
  // hands back — go through it.
  const onAction = useCallback(
    (action: WindowAction) => {
      spendShift();
      if (action.kind === WindowActionKind.LauncherToggled) {
        setLaunchedHere(true);
      }
      // With the key that ran it, which is what takes the pointer with the
      // keyboard — see `usePointerWarp`. Counted in the desktop rather than
      // on this page, because the page that answers it is the one covering
      // the screen the focus lands on, and that need not be this one; and
      // with this page's screen, because the keys are heard where the
      // pointer is.
      act(action, {
        on: displays?.find(({ scanout }) => scanout !== undefined)?.name,
      });
    },
    [act, displays, spendShift],
  );

  // The binding mode is the desk's: a key on any page enters it, and every
  // page reads its keys in it.
  useKeybindings({
    domicile,
    launcherOpen: windows.launcherOpen,
    mode: windows.mode,
    onAction,
    onModeChanged: (mode) => {
      act(WindowAction.ModeSet(mode));
    },
  });

  // The pointer carries the keyboard from one monitor to the next, windows or
  // none: the engine hands the keys to the monitor the pointer is on, and the
  // desktop's focus goes with them.
  useScreenFollowsPointer({ act, displays, focused: windows.focused });

  return (
    <>
      {/*
        First, and outside every screen: the viewport is this monitor, so one
        fixed sheet is its wallpaper, and a positioned sibling that comes first
        in the document is painted under all of it. It waits for no desktop
        either — there is no region for it to be moved into — so the handshake
        happens over a photograph.
      */}
      <Wallpaper />
      {/*
        Every display the desktop has taken up, which is every display the
        host described one render later: the desk reaches the state through a
        reduction, and a monitor drawn before that reduction lands would be a
        screen with no workspace on it. One frame of a monitor that has just
        been plugged in, which is a monitor that was dark a moment ago anyway.
      */}
      {(displays ?? [])
        .filter(({ name }) =>
          windows.screens.some((screen) => screen.name === name),
        )
        .map((display) => (
          <Monitor
            act={act}
            desk={displays ?? []}
            display={display}
            domicile={domicile}
            extensions={extensions}
            key={display.name}
            modifiers={modifiers}
            notifications={{
              onOpen: openNotifications,
              open: notificationsOpen,
              unread: notifications.unread,
            }}
            tray={tray}
            trayOrder={trayOrder}
            windows={windows}
          />
        ))}
      {/*
        Outside every screen, like the wallpaper and for the same reason: the
        viewport is this monitor, and the panel is over the whole of it.
      */}
      <Launcher
        here={launchedHere}
        onClosed={() => {
          setLaunchedHere(false);
        }}
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
            case LaunchKind.Browsed: {
              act(WindowAction.BrowserOpened(launch.url));
              break;
            }
          }
        }}
        open={windows.launcherOpen}
        opening={opening}
        preview={preview}
        search={search}
        searchApps={searchApps}
      />
      {/* Over the whole desktop, like the launcher and for its reason. */}
      <Clipboard
        entries={clipboard}
        onCopy={(entry) => {
          domicile.copyClipboardEntry(entry);
        }}
        onDismiss={() => {
          act(WindowAction.ClipboardDismissed());
        }}
        open={windows.clipboardOpen}
      />
      {/*
        Over the windows and under every panel: a toast over the launcher
        would cover what is being typed. Not drawn at all over a locked desk,
        whose lock screen they would read out to whoever is in front of it.
      */}
      <NotificationToasts
        manager={toasts}
        now={now}
        onAction={notifications.invoke}
        shown={!lock.locked}
      />
      {/* From the bar's far edge, over the whole desktop, like the clipboard. */}
      <NotificationDrawer
        items={notifications.items}
        now={now}
        onAction={notifications.invoke}
        onDismiss={notifications.dismiss}
        onOpenChange={(open) => {
          if (open) {
            openNotifications();
          } else {
            setNotificationsOpen(false);
          }
        }}
        open={notificationsOpen && !lock.locked}
      />
      {/*
        Last, and over every panel above it: the launcher and the clipboard are
        `modal`, and a lock screen underneath an open launcher would be a locked
        desk somebody could still type a path into.

        It draws over a desktop that has already stopped listening rather than
        stopping anything itself, and what takes it away is the compositor saying
        the desk opened — never this page's own click. See `lock/Lock.tsx`.
      */}
      <Lock
        checking={lock.checking}
        locked={lock.locked}
        onUnlock={lock.unlock}
        refusals={lock.refusals}
      />
      <NoScreens />
    </>
  );
};
