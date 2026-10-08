import type { Display } from "@domicile-desktop/component-library/display-source";
import type {
  DomicileHost,
  DomicileWindow,
} from "@domicile-desktop/sdk/domicile-host";
import { SystemErrorKind, system } from "@domicile-desktop/sdk/system";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { openFileCommand } from "../launcher/open-file";
import type { PlacedScreen } from "../screens/screen-toward";
import { appIdOf, browserIdOf } from "./window";
import { windowChanges } from "./window-changes";
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
 * @param openFile - the argv that opens a file the launcher chose.
 */
export const useWindows = (
  domicile: DomicileHost,
  displays: readonly Display[] | undefined,
  openFile: typeof openFileCommand = openFileCommand,
): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);
  // Memoized so `act` keeps its identity.
  const files = useMemo(() => system(domicile), [domicile]);

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
      if (action.kind === WindowActionKind.ScreenshotTaken) {
        takeScreenshot(domicile);
      }
      if (action.kind === WindowActionKind.FileOpened) {
        openFile(files, action.path)
          .then((argv) => {
            domicile.spawn(argv);
          })
          .catch((error: unknown) => {
            // biome-ignore lint/suspicious/noConsole: surfacing a file that did not open
            console.error(`Could not open ${action.path}`, error);
          });
      }
      if (action.kind === WindowActionKind.AppLaunched) {
        domicile.spawn(action.command);
      }
      if (action.kind === WindowActionKind.BrowserOpened) {
        if (action.isPrivate) {
          domicile.openPrivateBrowserWindow(action.src);
        } else {
          domicile.openBrowserWindow(action.src);
        }
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
    [domicile, files, openFile, state],
  );

  // The host's last window list, diffed against the next. A ref, not
  // effect-local, so a re-run effect does not announce every window again.
  const listed = useRef<readonly DomicileWindow[]>([]);

  useEffect(() => {
    // Client buffer sizes are ignored: only the engine's pointer scaling uses
    // them.
    const windowsChanged = () => {
      const now = domicile.windows;
      for (const action of windowChanges(listed.current, now)) {
        dispatch(action);
      }
      listed.current = now;
    };
    const focusChanged = () => {
      dispatch(Action.FocusChanged(domicile.focusedWindow ?? undefined));
    };
    // The compositor forwards the request without granting it;
    // `reduceWindows` decides.
    const focusRequested = ({ appId }: { appId: string }) => {
      dispatch(Action.FocusRequested(appId));
    };
    // Every browser window, from the engine. After `domicile load-shell` it
    // holds the previous shell's windows.
    const browserWindowsChanged = () => {
      const windows = domicile.browserWindows;
      if (windows !== null) {
        dispatch(Action.BrowserWindowsListed(windows));
      }
    };
    windowsChanged();
    focusChanged();
    browserWindowsChanged();
    domicile.addEventListener("windowschanged", windowsChanged);
    domicile.addEventListener("focusedwindowchanged", focusChanged);
    domicile.addEventListener("focusrequested", focusRequested);
    domicile.addEventListener("browserwindowschanged", browserWindowsChanged);
    return () => {
      domicile.removeEventListener("windowschanged", windowsChanged);
      domicile.removeEventListener("focusedwindowchanged", focusChanged);
      domicile.removeEventListener("focusrequested", focusRequested);
      domicile.removeEventListener(
        "browserwindowschanged",
        browserWindowsChanged,
      );
    };
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

/** Takes a screenshot, logging any failure but a dismissed dialog. */
const takeScreenshot = (domicile: DomicileHost) => {
  system(domicile)
    .screenshot()
    .then((taken) => {
      taken.match({
        Err: (error) => {
          if (error.kind !== SystemErrorKind.Canceled) {
            // biome-ignore lint/suspicious/noConsole: surfacing a failed screenshot
            console.error("The screenshot was not saved", error);
          }
        },
        // The PNG is under `$XDG_PICTURES_DIR/Screenshots/`, as a portal
        // screenshot's is, which says nothing either.
        Ok: () => undefined,
      });
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a broken system call
      console.error("The screenshot was not taken", error);
    });
};
