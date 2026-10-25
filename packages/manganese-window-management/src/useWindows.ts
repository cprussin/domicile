import type { Display } from "@domicile-desktop/component-library/display-source";
import { typedAddress } from "@domicile-desktop/manganese-address/typed-address";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { ClientWindow } from "@domicile-desktop/sdk/desktop/windows";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { WindowRequest } from "@domicile-desktop/sdk/window-state";
import { WindowRequestKind } from "@domicile-desktop/sdk/window-state";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { FloatingRules } from "./floating/floating-rules";
import { openCommand } from "./open-command";
import type { PlacedScreen } from "./screens/screen-toward";
import { appIdOf, appWindowId, browserIdOf } from "./window";
import { windowChanges } from "./window-changes";
import { hearWindowRequests } from "./window-requests";
import type { WindowAction, WindowState } from "./window-state";
import {
  WindowAction as Action,
  activeIdOf,
  activeIsPrivate,
  killedIdsOf,
  NO_WINDOWS,
  reduceWindows,
  WindowActionKind,
  windowsInGroup,
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
 * @param floating - which client windows open floating, besides dialogs.
 * @param openFile - the argv that opens a file the launcher chose.
 */
export const useWindows = (
  domicile: Domicile,
  displays: readonly Display[] | undefined,
  floating: FloatingRules,
  openFile: typeof openCommand = openCommand,
): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);
  // The state as last drawn, for `act` to read without depending on it. A new
  // `act` would re-add every listener that runs commands.
  const drawn = useRef(state);
  useLayoutEffect(() => {
    drawn.current = state;
  }, [state]);

  // Side effects the reducer cannot perform: spawning processes, locking,
  // asking a client to close, and opening or closing browser windows. A client
  // window is removed when the host reports it closed, and a browser window
  // when the engine's list drops it. Keeping these as actions keeps the
  // reducer pure and the bindings one table.
  const act = useCallback(
    (action: WindowAction) => {
      dispatch(action);
      if (action.kind === WindowActionKind.CommandExecuted) {
        domicile.processes.launch(action.argv);
      }
      if (action.kind === WindowActionKind.DeskLocked) {
        domicile.session.lock();
      }
      if (action.kind === WindowActionKind.ScreenshotTaken) {
        takeScreenshot(domicile);
      }
      if (action.kind === WindowActionKind.FileOpened) {
        domicile.processes.launch(openFile(action.path));
      }
      if (action.kind === WindowActionKind.AppLaunched) {
        domicile.processes.launch(action.command);
      }
      if (action.kind === WindowActionKind.ClipboardSearched) {
        // From a private window, the search stays private.
        const url = clipboardUrl(domicile);
        if (url !== undefined) {
          if (activeIsPrivate(drawn.current)) {
            domicile.browser.openPrivate(url);
          } else {
            domicile.browser.open(url);
          }
        }
      }
      if (action.kind === WindowActionKind.BrowserOpened) {
        if (action.isPrivate) {
          domicile.browser.openPrivate(action.src);
        } else {
          domicile.browser.open(action.src);
        }
      }
      if (action.kind === WindowActionKind.WindowClosed) {
        closeWindows(domicile, [action.id]);
      }
      // A `focus parent` selection closes whole, as in sway.
      if (action.kind === WindowActionKind.WindowKilled) {
        closeWindows(domicile, killedIdsOf(drawn.current));
      }
      if (action.kind === WindowActionKind.GroupClosed) {
        closeWindows(domicile, windowsInGroup(drawn.current, action.group));
      }
    },
    [domicile, openFile],
  );

  // The host's last window list, diffed against the next. A ref, not
  // effect-local, so a re-run effect does not announce every window again.
  const listed = useRef<readonly ClientWindow[]>([]);

  useEffect(() => {
    const { browser, windows } = domicile;
    // A client's size places only a window that opens floating; the engine's
    // pointer scaling uses it too.
    const windowsChanged = () => {
      const now = windows.list;
      for (const action of windowChanges(floating, listed.current, now)) {
        dispatch(action);
      }
      listed.current = now;
    };
    const focusChanged = () => {
      dispatch(Action.FocusChanged(windows.focused));
    };
    // The compositor forwards the request without granting it;
    // `reduceWindows` decides.
    const focusRequested = (appId: string) => {
      dispatch(Action.FocusRequested(appWindowId(appId)));
    };
    // Every browser window, from the engine. After `domicile load-shell` it
    // holds the previous shell's windows.
    const browserWindowsChanged = () => {
      const listedBrowsers = browser.windows;
      if (listedBrowsers !== undefined) {
        dispatch(Action.BrowserWindowsListed(listedBrowsers));
      }
    };
    windowsChanged();
    focusChanged();
    browserWindowsChanged();
    // `AppWindow` and `AppPopup` render each window's `frame`.
    windows.syncFrames();
    const stops = [
      windows.on("change", windowsChanged),
      windows.on("focuschange", focusChanged),
      windows.on("focusrequest", focusRequested),
      browser.on("change", browserWindowsChanged),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [domicile, floating]);

  // Clients' requests, which the compositor reports without granting.
  useEffect(() => {
    const hearing = hearWindowRequests(domicile, (request) => {
      const action = actionFor(request);
      if (action !== undefined) {
        dispatch(action);
      }
    });
    return hearing.stop;
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

/**
 * What a client's request does. Fullscreen fills the window's screen, as a
 * page's fullscreen does. Windows tile, so maximizing changes nothing.
 */
const actionFor = (request: WindowRequest): WindowAction | undefined => {
  switch (request.kind) {
    case WindowRequestKind.Fullscreen:
      return Action.PageFullscreened(appWindowId(request.appId), true);
    case WindowRequestKind.Unfullscreen:
      return Action.PageFullscreened(appWindowId(request.appId), false);
    case WindowRequestKind.Maximize:
    case WindowRequestKind.Unmaximize:
      return undefined;
  }
};

/** The desk's displays as the screens the desktop is told of. */
const placedOf = (displays: readonly Display[]): readonly PlacedScreen[] =>
  displays.map(({ name, position, size }) => ({
    box: { height: size[1], width: size[0], x: position[0], y: position[1] },
    name,
  }));

/** Takes a screenshot, logging any failure but a dismissed dialog. */
const takeScreenshot = (domicile: Pick<Domicile, "capture">) => {
  domicile.capture
    .screenshot()
    .then((taken) => {
      taken.match({
        Err: (error) => {
          if (error.kind !== SystemErrorKind.Canceled) {
            // biome-ignore lint/suspicious/noConsole: surfacing a failed screenshot
            console.error("The screenshot was not saved", error);
          }
        },
        // The PNG is under `$XDG_PICTURES_DIR/Screenshots/`, or on the
        // clipboard after Ctrl+C. A portal screenshot says nothing either.
        Ok: () => undefined,
      });
    })
    .catch((error: unknown) => {
      // biome-ignore lint/suspicious/noConsole: surfacing a broken desktop call
      console.error("The screenshot was not taken", error);
    });
};

/**
 * The newest copy as a site or a search URL, or `undefined` when the clipboard
 * holds no text.
 *
 * Reads the row's preview, so a copy longer than its first 160 characters is
 * cut short.
 */
const clipboardUrl = (
  domicile: Pick<Domicile, "clipboard">,
): string | undefined => {
  const newest = domicile.clipboard.entries?.[0];
  return newest === undefined ? undefined : typedAddress(newest.preview)?.url;
};

/** Asks the compositor or the engine to close each window in `ids`. */
const closeWindows = (
  domicile: Pick<Domicile, "browser" | "windows">,
  ids: readonly string[],
) => {
  for (const id of ids) {
    const appId = appIdOf(id);
    if (appId !== undefined) {
      domicile.windows.close(appId);
    }
    const browser = browserIdOf(id);
    if (browser !== undefined) {
      domicile.browser.close(browser);
    }
  }
};
