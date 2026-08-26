import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { DropPosition } from "@domicile/component-library/TabRail";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import type { AppElements } from "./app-elements";
import type { ShellState } from "./shell-state";
import { EMPTY_SHELL, reduceShell, ShellAction } from "./shell-state";
import { appIdOf, siteOf } from "./shell-window";

/** Where a browser window starts. */
const HOME_PAGE = "https://www.google.com";

/** What the terminal launcher asks the compositor to run. */
const TERMINAL_COMMAND = ["kitty"] as const;

export type ShellWindows = ShellState & {
  /**
   * Close the window `id` — what a tab's close button does.
   *
   * A client's window is the client's to end, so this asks it to; the window
   * leaves the list when the host says it went.
   */
  close: (id: string) => void;
  /** Open a browser window on the stage and give it the stage. */
  openBrowser: () => void;
  /** Ask the compositor to launch a terminal onto the stage. */
  openTerminal: () => void;
  /** Retitle the window `id` after its page navigated to `url`. */
  renameToSite: (id: string, url: string) => void;
  /** Move the window `fromId` to just before/after the window `toId`. */
  reorder: (fromId: string, toId: string, position: DropPosition) => void;
  /** Put the window `id` on the stage. */
  select: (id: string) => void;
};

/**
 * The shell's windows, and everything that changes them.
 *
 * The host's lifecycle events (a client appeared, a client is gone) are the
 * other half of the user's own actions, so both go through one reducer and the
 * chrome renders a single list. A client's *frames* do not come through here —
 * they go straight to the portal element via `appElements`, because a window of
 * pixels arriving many times a second has no business in React state.
 */
export const useShellWindows = (
  bridge: BridgeClient,
  appElements: AppElements,
): ShellWindows => {
  const [state, dispatch] = useReducer(reduceShell, EMPTY_SHELL);

  useEffect(() => {
    bridge.on("app_appeared", ({ app_id, size, title }) => {
      // The portal for this window mounts a render later, so the size waits
      // in `AppElements` until it registers. See `AppElements.announced`.
      appElements.announced(app_id, size);
      dispatch(ShellAction.AppAppeared(app_id, title));
    });
    bridge.on("app_titled", ({ app_id, title }) => {
      dispatch(ShellAction.AppTitled(app_id, title));
    });
    bridge.on("app_closed", ({ app_id }) => {
      // The client going is what ends the record, not the portal unmounting.
      // See `AppElements.closed`.
      appElements.closed(app_id);
      dispatch(ShellAction.AppClosed(app_id));
    });
    bridge.on("app_frame", (message) => {
      appElements.drawFrame(message);
    });
    bridge.on("app_resized", (message) => {
      appElements.resize(message);
    });
    bridge.on("app_cursor", (message) => {
      appElements.applyCursor(message);
    });
    bridge.on("app_composited", (message) => {
      appElements.composited(message);
    });
    bridge.on("focus_changed", ({ app_id }) => {
      dispatch(ShellAction.FocusChanged(app_id));
    });
  }, [appElements, bridge]);

  const close = useCallback(
    (id: string) => {
      const appId = appIdOf(id);
      if (appId === undefined) {
        dispatch(ShellAction.WindowClosed(id));
      } else {
        // Nothing here ends a client: the compositor sends its toplevel a
        // close, and an editor with unsaved work is entitled to stay. What
        // takes the tab away is the `app_closed` that follows if it goes.
        bridge.closeApp(appId);
      }
    },
    [bridge],
  );

  const openBrowser = useCallback(() => {
    dispatch(ShellAction.BrowserOpened(HOME_PAGE));
  }, []);

  const openTerminal = useCallback(() => {
    bridge.spawn(TERMINAL_COMMAND);
  }, [bridge]);

  const renameToSite = useCallback((id: string, url: string) => {
    dispatch(ShellAction.WindowRenamed(id, siteOf(url)));
  }, []);

  const reorder = useCallback(
    (fromId: string, toId: string, position: DropPosition) => {
      dispatch(ShellAction.WindowsReordered(fromId, toId, position));
    },
    [],
  );

  const select = useCallback((id: string) => {
    dispatch(ShellAction.WindowSelected(id));
  }, []);

  return useMemo(
    () => ({
      ...state,
      close,
      openBrowser,
      openTerminal,
      renameToSite,
      reorder,
      select,
    }),
    [close, openBrowser, openTerminal, renameToSite, reorder, select, state],
  );
};
