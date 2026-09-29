import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import type { Display } from "@domicile/component-library/display-source";
import { Screen } from "@domicile/component-library/Screen";
import type { RefObject } from "react";
import { useMemo, useState } from "react";

import { popupShown } from "../extensions/shown";
import type { Modifiers } from "../keyboard/useModifiers";
import { TOP_BAR, TopBar } from "../top-bar/TopBar";
import type { Geometry, Screenful } from "../window-management/placement";
import { placementsOf } from "../window-management/placement";
import type { Focus } from "../window-management/pointer-warp";
import type { Rect } from "../window-management/rect";
import { Stage } from "../window-management/Stage";
import { usePointerWarp } from "../window-management/usePointerWarp";
import type { Windows } from "../window-management/useWindows";
import { siteOf } from "../window-management/window";
import {
  currentOn,
  WindowAction,
  workspaceOn,
  workspacesOn,
} from "../window-management/window-state";

type Props = {
  /** Run a command: a press on this monitor's chrome. */
  act: (action: WindowAction) => void;
  /** Which monitor this is, and where it is on the desk. */
  display: Display;
  /** The desk it is one of — what a window filling every screen fills. */
  desk: readonly Display[];
  domicile: DomicileClient;
  /** The extensions with an action, for the tray on this monitor's bar. */
  extensions: readonly Extension[];
  /**
   * Whether a key ran the command this render is the answer to, which is what
   * takes the pointer with the keyboard — see {@link usePointerWarp}. The
   * desk is one keyboard and several monitors, so the press is read a screen
   * above this and spent on whichever monitor the focus landed on.
   */
  keyed: RefObject<boolean>;
  /** What the user is holding down, which decides who gets the pointer. */
  modifiers: Modifiers;
  windows: Windows;
};

/**
 * One monitor of the desk: the bar across the top of it, and the windows of
 * the workspace it is showing.
 *
 * **THIS IS WHERE A DESK OF SEVERAL MONITORS IS SEVERAL PAGES.** The engine
 * opens a browser window per CRTC and each one loads this same shell, so every
 * page renders one of these per screen and `<Screen>` draws the one whose
 * display its window covers. The others are the same element in the page
 * next door: the desktop is one state, drawn a monitor at a time.
 *
 * So the windows of a workspace are drawn by exactly one page, which is not a
 * nicety. A client's window is a frame sink and a frame sink has one parent:
 * two pages embedding one window is the second taking the first's pixels
 * away, leaving a terminal that answers the keyboard and draws nothing.
 */
export const Monitor = ({
  act,
  desk,
  display,
  domicile,
  extensions,
  keyed,
  modifiers,
  windows,
}: Props) => {
  const geometry = useMemo(() => geometryOf(display, desk), [desk, display]);
  const screenful = useMemo(
    () => placementsOf(windows, geometry),
    [geometry, windows],
  );
  const current = currentOn(windows, display.name);
  const workspace = workspaceOn(windows, display.name);

  // And the pointer goes where the keyboard goes, because the pointer is what
  // moves the keyboard here: focus follows the cursor, so a focus change the
  // pointer did not make — a key, or a window opening — would be undone by the
  // next pointer event. `pointer-warp.ts` has the whole of it.
  //
  // Per monitor, and it answers `undefined` on every one but the monitor the
  // window is on: a page cannot put the pointer on somebody else's screen, and
  // `focusOn` reads this screen's own placements, which is where the answer
  // comes from.
  const focus = useMemo(
    () => focusOn(screenful, windows.activeId),
    [screenful, windows.activeId],
  );
  const open = useMemo(
    () => windows.windows.map(({ id }) => id),
    [windows.windows],
  );
  const { pointing } = usePointerWarp({
    domicile,
    focus,
    keyed,
    windows: open,
  });

  // The extension whose popup is open under this bar's tray. This monitor's
  // rather than the desk's: the panel hangs off one bar, and the windows it
  // takes the keyboard from are the ones this monitor draws.
  const [opened, setOpened] = useState<string | undefined>(undefined);
  // And forgotten once the tray stops drawing it — its action disabled or its
  // extension dropped — so an `action.enable()` later does not reopen a panel
  // nobody clicked. Set during render, React's pattern for state that follows
  // a prop, so no frame draws the stale answer.
  const popupOpen = popupShown(extensions, opened);
  if (opened !== undefined && !popupOpen) {
    setOpened(undefined);
  }

  return (
    <Screen name={display.name}>
      <TopBar
        current={current}
        domicile={domicile}
        extensions={extensions}
        focused={windows.focused === display.name}
        mode={windows.mode}
        onOpenExtension={setOpened}
        onSelectWorkspace={(name) => {
          act(WindowAction.WorkspaceSelected(name));
        }}
        openedExtension={opened}
        workspaces={workspacesOn(windows, display.name)}
      />
      <Stage
        activeId={windows.activeId}
        // A panel of the desktop's own is a thing to type into that no
        // window knows about, so for as long as one is up the keyboard
        // is the page's — see `AppWindow`. An extension's popup is one.
        behindPanel={windows.launcherOpen || windows.clipboardOpen || popupOpen}
        current={current}
        domicile={domicile}
        draggingId={windows.draggingId}
        floats={workspace.floats}
        focusedId={windows.focusedId}
        fullscreenId={workspace.fullscreen?.id}
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
        onMove={(id, x, y) => {
          act(WindowAction.WindowMoved(id, x, y));
        }}
        onOpenWindow={(url) => {
          act(WindowAction.BrowserOpened(url));
        }}
        onRename={(id, url) => {
          act(WindowAction.WindowRenamed(id, siteOf(url)));
        }}
        onResize={(id, box) => {
          act(WindowAction.WindowResized(id, box));
        }}
        onSelect={(id) => {
          act(WindowAction.WindowSelected(id));
        }}
        // With this monitor's own workspace box, which is what the tiling on
        // it is laid out in and so what a dragged pixel is a share of.
        onStretch={(id, edge, by) => {
          act(WindowAction.WindowStretched(id, edge, by, geometry.workspace));
        }}
        popups={windows.popups}
        screenful={screenful}
        width={geometry.screen.width}
        windows={windows.windows}
      />
    </Screen>
  );
};

/**
 * The window the keyboard is in on THIS monitor and the box a pointer over it
 * would be in, or `undefined` when the keyboard is somewhere else.
 *
 * Its contents rather than its whole frame, and that is the box the question
 * is about: what a `pointerover` moves the focus to is the `<app>` element —
 * see `Stage` — so the region the pointer has to be in to hold the focus is
 * the one the window draws in, not the bar above it. A window a tab is hiding
 * has only that bar, which is where the window is.
 */
const focusOn = (
  screenful: Screenful,
  activeId: string | undefined,
): Focus | undefined => {
  const placement = screenful.placements.find(({ id }) => id === activeId);
  return placement === undefined
    ? undefined
    : {
        box: placement.surface ?? placement.bar,
        id: placement.id,
      };
};

/**
 * The rectangles this monitor has to offer.
 *
 * Three of them, because a window can be asked to fill any of the three: the
 * workspace is this screen with the bar taken off the top, `fullscreen` is the
 * whole of it, and `fullscreen global` is every screen there is — as far as
 * one monitor can show it, which is all a page that is one monitor can do.
 */
const geometryOf = (display: Display, desk: readonly Display[]): Geometry => {
  const screen = rectOf(display);
  return {
    desktop: boundingBox(desk),
    name: display.name,
    screen,
    workspace: {
      ...screen,
      height: screen.height - TOP_BAR,
      y: screen.y + TOP_BAR,
    },
  };
};

const rectOf = (display: Display): Rect => ({
  height: display.size[1],
  width: display.size[0],
  x: display.position[0],
  y: display.position[1],
});

/**
 * Every screen at once, which is what `fullscreen global` fills.
 *
 * In this page's own coordinates, which is what the host describes: the
 * display this window covers is at the origin and the rest of the desk is
 * placed around it, so a box over the whole desk has a corner this page can
 * draw from and edges it cannot reach.
 */
const boundingBox = (desk: readonly Display[]): Rect => {
  const rects = desk.map((display) => rectOf(display));
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    x,
    y,
  };
};
