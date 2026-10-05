import type { Display } from "@domicile-desktop/component-library/display-source";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import { openCommand } from "../launcher/open-command";
import type { PlacedScreen } from "../screens/screen-toward";
import { appIdOf, browserIdOf } from "./window";
import type { WindowAction, WindowState } from "./window-state";
import {
  WindowAction as Action,
  activeIdOf,
  NO_WINDOWS,
  reduceWindows,
  WindowActionKind,
} from "./window-state";

export type Windows = WindowState & {
  /**
   * Dispatches a desktop action from a key binding or the chrome.
   *
   * A single entry point keeps the key bindings a table of actions. It also
   * runs the side effects the reducer cannot, such as `exec` and `kill`.
   */
  act: (action: WindowAction) => void;
  /** The active window, floating or tiled. */
  activeId: string | undefined;
};

/**
 * The desktop's windows and the actions that change them.
 *
 * Host events (clients appearing, closing, setting a cursor) and user commands
 * share one reducer. Client pixels never pass through the page: the `<app>`
 * element embeds the compositor's surface.
 *
 * @param displays - the desk the host described. `undefined` until it has
 *   described one.
 */
export const useWindows = (
  domicile: DomicileClient,
  displays: readonly Display[] | undefined,
): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);

  // Side effects the reducer cannot perform: spawning processes, locking,
  // asking a client to close, and opening or closing browser windows. A client
  // window is removed when the host reports it closed, and a browser window
  // when the engine's list drops it. Keeping these as actions keeps the
  // reducer pure and the bindings one table.
  const act = useCallback(
    (action: WindowAction) => {
      dispatch(action);
      if (action.kind === WindowActionKind.CommandExecuted) {
        domicile.spawn(action.argv);
      }
      if (action.kind === WindowActionKind.DeskLocked) {
        domicile.lock();
      }
      // `openCommand` runs through a shell because `$HOME` is only known to the
      // spawned process, not to a page served over `domicile://`.
      if (action.kind === WindowActionKind.FileOpened) {
        domicile.spawn(openCommand(action.path));
      }
      if (action.kind === WindowActionKind.AppLaunched) {
        domicile.spawn(action.command);
      }
      if (action.kind === WindowActionKind.BrowserOpened) {
        domicile.openBrowserWindow(action.src);
      }
      if (
        action.kind === WindowActionKind.WindowKilled ||
        action.kind === WindowActionKind.WindowClosed
      ) {
        const id =
          action.kind === WindowActionKind.WindowClosed
            ? action.id
            : activeIdOf(state);
        const appId = id === undefined ? undefined : appIdOf(id);
        if (appId !== undefined) {
          domicile.closeApp(appId);
        }
        const browser = id === undefined ? undefined : browserIdOf(id);
        if (browser !== undefined) {
          domicile.closeBrowserWindow(browser);
        }
      }
    },
    [domicile, state],
  );

  useEffect(() => {
    // Client buffer sizes are ignored: only the SDK's pointer scaling uses
    // them, and `DomicileClient` records them itself.
    domicile.on("app_appeared", ({ app_id, title }) => {
      dispatch(Action.AppAppeared(app_id, title));
    });
    domicile.on("app_titled", ({ app_id, title }) => {
      dispatch(Action.AppTitled(app_id, title));
    });
    domicile.on("app_min_size", ({ app_id, size }) => {
      dispatch(Action.AppMinSize(app_id, size));
    });
    domicile.on("app_max_size", ({ app_id, size }) => {
      dispatch(Action.AppMaxSize(app_id, size));
    });
    domicile.on("popup_placed", ({ app_id, parent, position, size }) => {
      dispatch(Action.PopupPlaced({ appId: app_id, parent, position, size }));
    });
    domicile.on("app_closed", ({ app_id }) => {
      dispatch(Action.AppClosed(app_id));
    });
    domicile.on("app_cursor", ({ app_id, cursor }) => {
      dispatch(Action.AppCursorChanged(app_id, cursor));
    });
    domicile.on("focus_changed", ({ app_id }) => {
      dispatch(Action.FocusChanged(app_id));
    });
    domicile.on("focus_requested", ({ app_id }) => {
      // The compositor forwards the request without granting it;
      // `reduceWindows` decides.
      dispatch(Action.FocusRequested(app_id));
    });
    // Every browser window, from the engine. After `domicile load-shell` it
    // holds the previous shell's windows.
    domicile.on("browser_windows", ({ windows }) => {
      dispatch(Action.BrowserWindowsListed(windows));
    });
  }, [domicile]);

  // The desk the host described, which bounds where windows can go.
  useEffect(() => {
    if (displays !== undefined) {
      dispatch(Action.ScreensDescribed(placedOf(displays)));
    }
  }, [displays]);

  return useMemo(
    () => ({
      ...state,
      act,
      activeId: activeIdOf(state),
    }),
    [act, state],
  );
};

/** The desk's displays as the screens the desktop is told of. */
const placedOf = (displays: readonly Display[]): readonly PlacedScreen[] =>
  displays.map(({ name, position, size }) => ({
    box: { height: size[1], width: size[0], x: position[0], y: position[1] },
    name,
  }));
