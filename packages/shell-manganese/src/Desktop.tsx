import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { createToastManager } from "@domicile/component-library/Toaster";
import { useCallback, useMemo, useState } from "react";

import { Clipboard } from "./clipboard/Clipboard";
import { useClipboard } from "./clipboard/useClipboard";
import { popupShown } from "./extensions/shown";
import { useExtensions } from "./extensions/useExtensions";
import { useModifiers } from "./keyboard/useModifiers";
import { useShortcuts } from "./keyboard/useShortcuts";
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
import type { StageScreen } from "./screens/stage-screens";
import { stageScreensOf } from "./screens/stage-screens";
import { useScreenFollowsPointer } from "./screens/useScreenFollowsPointer";
import { useTray } from "./tray/useTray";
import { useTrayOrder } from "./tray/useTrayOrder";
import { Wallpaper } from "./wallpaper/Wallpaper";
import type { Focus } from "./window-management/pointer-warp";
import { Stage } from "./window-management/Stage";
import { usePointerWarp } from "./window-management/usePointerWarp";
import { useWindows } from "./window-management/useWindows";
import { siteOf } from "./window-management/window";
import { WindowAction } from "./window-management/window-state";

type Props = {
  domicile: DomicileClient;
};

/**
 * The desktop: a bar across the top of every monitor, the windows of the
 * workspace each one is showing under it, and the panels over all of it.
 *
 * **ONE PAGE FOR THE DESK.** The page spans every monitor, and renders a
 * {@link Monitor} for each, each in its own region of the page — and one
 * {@link Stage} over all of them, which draws every window once at its place
 * on the page.
 *
 * So the state above the monitors is the desk's and not a screen's: the
 * workspaces span every monitor the way sway's do, a workspace is shown on one
 * screen at a time, and asking for one that is already in view moves the
 * keyboard to the screen showing it rather than taking the work off it.
 */
export const Desktop = ({ domicile }: Props) => {
  const displays = useDisplays();
  const windows = useWindows(domicile, displays);
  const { act } = windows;

  // Super is what hands the pointer back to the page, and Shift is what makes
  // a drag a resize. Both come off this page's own keyboard events — the
  // desktop is the chrome's window, so the compositor's own answer is these
  // keystrokes handed back short — and off the engine's word for a browser
  // window's page, whose keys this page never hears.
  const { modifiers, spendShift } = useModifiers(domicile);

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
  // rather than once per bar: `on` is a single slot, and the page draws a bar
  // per monitor.
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

  // The screens the desktop has taken up, and what each one shows.
  const screens = useMemo(
    () => stageScreensOf(windows, displays ?? []),
    [displays, windows],
  );

  // And the pointer goes where the keyboard goes, because the pointer is what
  // moves the keyboard here: focus follows the cursor, so a focus change the
  // pointer did not make — a key, or a window opening — would be undone by the
  // next pointer event. `pointer-warp.ts` has the whole of it.
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

  // The extension whose popup is open, and the bar whose tray it hangs off.
  const [opened, setOpened] = useState<
    { extension: string; screen: string } | undefined
  >(undefined);
  // And forgotten once the tray stops drawing it — its action disabled or its
  // extension dropped — so an `action.enable()` later does not reopen a panel
  // nobody clicked. Set during render, React's pattern for state that follows
  // a prop, so no frame draws the stale answer.
  const popupOpen = popupShown(extensions, opened?.extension);
  if (opened !== undefined && !popupOpen) {
    setOpened(undefined);
  }

  // The Shift of the chord that floats a window is spent whether or not there
  // was a window to float, because what it says is about the press rather than
  // the outcome: the user pressed it to reach the chord, and a Shift the
  // desktop has already answered is not one held over the window that lands.
  // Both paths into here — the page's own keydown and the chord the compositor
  // hands back — go through it.
  const onAction = useCallback(
    (action: WindowAction) => {
      spendShift();
      act(action);
      // Counted, which is what takes the pointer with the keyboard — see
      // `usePointerWarp`. In the desktop rather than here, because what
      // answers it is the monitor the focus lands on. In the same turn, so
      // the two are one render.
      act(WindowAction.KeyPressed());
    },
    [act, spendShift],
  );

  useShortcuts({
    domicile,
    launcherOpen: windows.launcherOpen,
    mode: windows.mode,
    onAction,
  });

  // The pointer carries the keyboard from one monitor to the next, windows or
  // none.
  useScreenFollowsPointer({ act, displays, focused: windows.focused });

  return (
    <>
      {/*
        First, and outside every screen: one fixed sheet is the wallpaper, and
        a positioned sibling that comes first in the document is painted under
        all of it. It waits for no desktop either — there is no region for it
        to be moved into — so the handshake happens over a photograph.
      */}
      <Wallpaper />
      {/*
        Every display the desktop has taken up, which is every display the
        host described one render later: the desk reaches the state through a
        reduction, and a monitor drawn before that reduction lands would be a
        screen with no workspace on it. One frame of a monitor that has just
        been plugged in, which is a monitor that was dark a moment ago anyway.
      */}
      {screens.map(({ geometry: { name } }) => (
        <Monitor
          act={act}
          domicile={domicile}
          extensions={extensions}
          key={name}
          name={name}
          notifications={{
            onOpen: openNotifications,
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
          tray={tray}
          trayOrder={trayOrder}
          windows={windows}
        />
      ))}
      {/*
        Every window, once for the desk and after every monitor's bar, so a
        window wins a tie with any bar it is drawn over — see `Stage`. Not on
        a desk with no screen to draw one on.
      */}
      {screens.length > 0 && (
        <Stage
          activeId={windows.activeId}
          // A panel of the desktop's own is a thing to type into that no
          // window knows about, so for as long as one is up the keyboard
          // is the page's — see `AppWindow`. An extension's popup is one.
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
          onDropOn={(id, target, edge) => {
            act(WindowAction.WindowDroppedOn(id, target, edge));
          }}
          onFullscreen={(id) => {
            act(WindowAction.WindowFullscreened(id));
          }}
          onGrab={(id) => {
            act(WindowAction.WindowGrabbed(id));
          }}
          // Only where the pointer is what did the crossing. A window that
          // arrives under a hand nobody moved says `pointerover` just as
          // loudly, and answering that one hands the keyboard — and whatever
          // `focus parent` had selected — to whichever window the layout
          // happened to slide past. See `usePointerWarp`.
          onHover={(id, at) => {
            if (pointing(at)) {
              act(WindowAction.WindowHovered(id));
            }
          }}
          // In the page's pixels, which are the desk's: a drag can carry a
          // float onto another screen — see `floatDragged`.
          onMove={(id, x, y) => {
            act(WindowAction.WindowMoved(id, x, y));
          }}
          onOpenWindow={(url) => {
            act(WindowAction.BrowserOpened(url));
          }}
          onRename={(id, url) => {
            act(WindowAction.WindowRenamed(id, siteOf(url)));
          }}
          // Back into the pixels of the screen the float is on.
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
          // With the screen's own workspace box, which is what the tiling on
          // it is laid out in and so what a dragged pixel is a share of.
          onStretch={(id, edge, by, on) => {
            act(WindowAction.WindowStretched(id, edge, by, on.workspace));
          }}
          popups={windows.popups}
          screens={screens}
          windows={windows.windows}
        />
      )}
      {/*
        Outside every screen, like the wallpaper.
      */}
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

/**
 * The window the keyboard is in and the box a pointer over it would be in —
 * or the whole of the screen it is on, when there is no window to be in.
 *
 * The screen's middle is where sway puts the pointer on an output with nothing
 * on it, and a pointer left on the screen the keyboard came from would take it
 * straight back.
 *
 * Its contents rather than its whole frame, and that is the box the question
 * is about: what a `pointerover` moves the focus to is the `<app>` element —
 * see `Stage` — so the region the pointer has to be in to hold the focus is
 * the one the window draws in, not the bar above it. A window a tab is hiding
 * has only that bar, which is where the window is.
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

/** The popup open, once the bar `screen` has closed its own. */
const closedOn = (
  opened: { extension: string; screen: string } | undefined,
  screen: string,
): { extension: string; screen: string } | undefined =>
  opened?.screen === screen ? undefined : opened;
