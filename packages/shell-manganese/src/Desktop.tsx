import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useDisplays } from "@domicile/component-library/DisplayProvider";
import type { Display } from "@domicile/component-library/display-source";
import { useCallback, useMemo } from "react";

import { useModifiers } from "./keyboard/useModifiers";
import { useShortcuts } from "./keyboard/useShortcuts";
import { FirstScreen } from "./screens/FirstScreen";
import { IdleScreen } from "./screens/IdleScreen";
import { NoScreens } from "./screens/NoScreens";
import { OtherScreens } from "./screens/OtherScreens";
import { TOP_BAR, TopBar } from "./top-bar/TopBar";
import { Wallpaper } from "./wallpaper/Wallpaper";
import type { Geometry } from "./window-management/placement";
import { placementsOf } from "./window-management/placement";
import type { Rect } from "./window-management/rect";
import { Stage } from "./window-management/Stage";
import { useWindows } from "./window-management/useWindows";
import { HOME_PAGE, siteOf } from "./window-management/window";
import { WindowAction, workspaceOn } from "./window-management/window-state";

type Props = {
  domicile: DomicileClient;
};

/**
 * The desktop: a bar across the top of the screen the config names first, the
 * windows of the workspace being looked at under it, and a clock on every
 * other screen.
 *
 * One page, so one copy of this state across every display: moving a window
 * between workspaces is moving where its `<app>` is laid out, not handing it
 * to another shell. The state lives here rather than in the chrome because the
 * chrome is not mounted until a desktop has been described, and the windows
 * the host announces before then are already the shell's.
 */
export const Desktop = ({ domicile }: Props) => {
  const windows = useWindows(domicile);
  const { act } = windows;

  // Super is what hands the pointer back to the page, and Shift is what makes
  // a drag a resize. Both come off this page's own keyboard events, which is
  // the only place either can be read: the desktop is the chrome's window, so
  // the compositor's own answer is these keystrokes handed back short.
  const { modifiers, spendShift } = useModifiers();

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
    },
    [act, spendShift],
  );

  useShortcuts({ domicile, mode: windows.mode, onAction: onAction });

  // The screen the chrome is on, which is what the windows are laid out in.
  // Nothing is placed until the host has described a desktop — `FirstScreen`
  // renders nothing either — so an undescribed desktop has no geometry and
  // no windows on screen.
  const displays = useDisplays();
  const geometry = useMemo(() => geometryOf(displays), [displays]);
  const screenful = useMemo(
    () =>
      geometry === undefined
        ? { placements: [], tabs: [] }
        : placementsOf(windows, geometry),
    [geometry, windows],
  );

  return (
    <>
      {/*
        First, and outside every screen: the viewport is the desktop, so one
        fixed sheet is the wallpaper of every screen on it, and a positioned
        sibling that comes first in the document is painted under all of them.
        It waits for no desktop either — there is no region for it to be moved
        into — so the handshake happens over a photograph.
      */}
      <Wallpaper />
      <FirstScreen>
        <TopBar
          current={windows.current}
          mode={windows.mode}
          occupied={windows.occupied}
          onNew={() => {
            act(WindowAction.BrowserOpened(HOME_PAGE));
          }}
          onOpenTerminal={() => {
            act(WindowAction.TerminalLaunched());
          }}
          onSelectWorkspace={(name) => {
            act(WindowAction.WorkspaceSelected(name));
          }}
        />
        <Stage
          activeId={windows.activeId}
          current={windows.current}
          domicile={domicile}
          draggingId={windows.draggingId}
          floats={workspaceOn(windows).floats}
          focusedId={windows.focusedId}
          modifiers={modifiers}
          onClose={(id) => {
            act(WindowAction.WindowClosed(id));
          }}
          onDrop={() => {
            act(WindowAction.WindowDropped());
          }}
          onGrab={(id) => {
            act(WindowAction.WindowGrabbed(id));
          }}
          onHover={(id) => {
            act(WindowAction.WindowHovered(id));
          }}
          onMove={(id, x, y) => {
            act(WindowAction.WindowMoved(id, x, y));
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
      </FirstScreen>
      <OtherScreens>
        <IdleScreen />
      </OtherScreens>
      <NoScreens />
    </>
  );
};

/**
 * The rectangles the layout needs, or `undefined` before the host has
 * described a desktop.
 *
 * Three of them, because a window can be asked to fill any of the three: the
 * workspace is the screen the chrome is on with the bar taken off the top,
 * `fullscreen` is that whole screen, and `fullscreen global` is every screen
 * there is.
 */
const geometryOf = (
  displays: readonly Display[] | undefined,
): Geometry | undefined => {
  const first = displays?.[0];
  if (displays === undefined || first === undefined) {
    return undefined;
  } else {
    const screen = rectOf(first);
    return {
      desktop: boundingBox(displays),
      screen,
      workspace: {
        ...screen,
        height: screen.height - TOP_BAR,
        y: screen.y + TOP_BAR,
      },
    };
  }
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
 * The desktop's coordinates start at the top-left of this box, so its own
 * corner is the origin for a desktop the host has described sensibly — and it
 * is worked out rather than assumed, because a config may put a screen
 * anywhere and the compositor normalizes nothing.
 */
const boundingBox = (displays: readonly Display[]): Rect => {
  const rects = displays.map((display) => rectOf(display));
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    x,
    y,
  };
};
