import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Display } from "@domicile/component-library/display-source";
import { Screen } from "@domicile/component-library/Screen";
import type { RefObject } from "react";
import { useMemo } from "react";

import type { Modifiers } from "../keyboard/useModifiers";
import { TOP_BAR, TopBar } from "../top-bar/TopBar";
import type { Geometry, Screenful } from "../window-management/placement";
import { placementsOf } from "../window-management/placement";
import type { Focus } from "../window-management/pointer-warp";
import { pageBoxOf } from "../window-management/pointer-warp";
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
    () => focusOn(screenful, windows.activeId, display),
    [display, screenful, windows.activeId],
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

  return (
    <Screen name={display.name}>
      <TopBar
        current={current}
        domicile={domicile}
        focused={windows.focused === display.name}
        mode={windows.mode}
        onSelectWorkspace={(name) => {
          act(WindowAction.WorkspaceSelected(name));
        }}
        workspaces={workspacesOn(windows, display.name)}
      />
      <Stage
        activeId={windows.activeId}
        // A panel of the desktop's own is a thing to type into that no
        // window knows about, so for as long as one is up the keyboard
        // is the page's — see `AppWindow`.
        behindPanel={windows.launcherOpen || windows.clipboardOpen}
        current={current}
        display={display}
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
        onResize={(id, width, height) => {
          act(WindowAction.WindowResized(id, width, height));
        }}
        onSelect={(id) => {
          act(WindowAction.WindowSelected(id));
        }}
        screenful={screenful}
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
 *
 * **In the page's coordinates and not the layout's**, which is `pageBoxOf`'s
 * whole reason: a pointer exists in what the page draws, and where a page is
 * one monitor those are not the same numbers.
 */
const focusOn = (
  screenful: Screenful,
  activeId: string | undefined,
  display: Display,
): Focus | undefined => {
  const placement = screenful.placements.find(({ id }) => id === activeId);
  return placement === undefined
    ? undefined
    : {
        box: pageBoxOf(placement.surface ?? placement.bar, display),
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
