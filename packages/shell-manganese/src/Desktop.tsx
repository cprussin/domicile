import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { useCallback, useEffect, useRef } from "react";

import { Clipboard } from "./clipboard/Clipboard";
import { useClipboard } from "./clipboard/useClipboard";
import { useModifiers } from "./keyboard/useModifiers";
import { useShortcuts } from "./keyboard/useShortcuts";
import { Launcher } from "./launcher/Launcher";
import { LaunchKind } from "./launcher/launch";
import { Monitor } from "./screens/Monitor";
import { NoScreens } from "./screens/NoScreens";
import { Wallpaper } from "./wallpaper/Wallpaper";
import type { DeskChannel } from "./window-management/desk-channel";
import { useWindows } from "./window-management/useWindows";
import { WindowAction } from "./window-management/window-state";

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
  // a drag a resize. Both come off this page's own keyboard events, which is
  // the only place either can be read: the desktop is the chrome's window, so
  // the compositor's own answer is these keystrokes handed back short.
  const { modifiers, spendShift } = useModifiers();

  // A key ran the last command, which is what takes the pointer with the
  // keyboard — see `usePointerWarp`, which spends it. Here rather than in a
  // monitor because the desk is one keyboard and several screens: the press
  // happens once and the monitor the focus lands on is the one that answers
  // it.
  const keyed = useRef(false);

  // The launcher's rows are the host's answer to what is in its box: the
  // compositor keeps an index of the home and searches it, and all that
  // crosses into this page is what matched. One function for the life of the
  // client, because a new one would be a new search.
  const search = useCallback(
    (query: string) => domicile.searchFiles(query),
    [domicile],
  );
  // And its preview, of the same index, for the same reason.
  const preview = useCallback(
    (path: string) => domicile.previewFile(path),
    [domicile],
  );

  // Pushed rather than asked for, which is the other shape: a copy is an event
  // the compositor already hears, so the history is here before the panel is
  // opened rather than fetched when it is.
  const clipboard = useClipboard(domicile);

  // The Shift of the chord that floats a window is spent whether or not there
  // was a window to float, because what it says is about the press rather than
  // the outcome: the user pressed it to reach the chord, and a Shift the
  // desktop has already answered is not one held over the window that lands.
  // Both paths into here — the page's own keydown and the chord the compositor
  // hands back — go through it.
  const onAction = useCallback(
    (action: WindowAction) => {
      // Before the action, though either would do: what the press is
      // remembered for is the render that follows it, and no render happens
      // in the middle of an event handler.
      keyed.current = true;
      spendShift();
      act(action);
    },
    [act, spendShift],
  );

  useShortcuts({ domicile, mode: windows.mode, onAction });

  // And the press is spent here rather than in the monitor that answered it.
  // A parent's effect runs after its children's, so by the time this one does
  // every monitor has had its look — where clearing it in the hook would let
  // the first monitor to run spend a press the second was meant to answer.
  useEffect(() => {
    keyed.current = false;
  });

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
            key={display.name}
            keyed={keyed}
            modifiers={modifiers}
            windows={windows}
          />
        ))}
      {/*
        Outside every screen, like the wallpaper and for the same reason: the
        viewport is this monitor, and the panel is over the whole of it.
      */}
      <Launcher
        onDismiss={() => {
          act(WindowAction.LauncherDismissed());
        }}
        onLaunch={(launch) => {
          switch (launch.kind) {
            case LaunchKind.Edited: {
              act(WindowAction.EditorLaunched(launch.path));
              break;
            }
            case LaunchKind.Browsed: {
              act(WindowAction.BrowserOpened(launch.url));
              break;
            }
          }
        }}
        open={windows.launcherOpen}
        preview={preview}
        search={search}
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
      <NoScreens />
    </>
  );
};
