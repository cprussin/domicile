import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { DropPosition } from "@domicile/component-library/TabRail";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import { appIdOf, siteOf } from "./window";
import type { WindowState } from "./window-state";
import {
  floatingOf,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
} from "./window-state";

/** Where a browser window starts. */
const HOME_PAGE = "https://www.google.com";

/** What the terminal launcher asks the compositor to run. */
const TERMINAL_COMMAND = ["kitty"] as const;

export type Windows = WindowState & {
  /**
   * Close the window `id` — what a tab's close button does.
   *
   * A client's window is the client's to end, so this asks it to; the window
   * leaves the list when the host says it went.
   */
  close: (id: string) => void;
  /** The user let go of the window they had hold of. */
  drop: () => void;
  /** Take hold of the floating window `id`, which also raises it. */
  grab: (id: string) => void;
  /** Put the floating window `id`'s top-left corner at `x`,`y`. */
  move: (id: string, x: number, y: number) => void;
  /** Open a browser window on the stage and give it the stage. */
  openBrowser: () => void;
  /** Ask the compositor to launch a terminal onto the stage. */
  openTerminal: () => void;
  /** Give the floating window `id` a new size. */
  resize: (id: string, width: number, height: number) => void;
  /** Retitle the window `id` after its page navigated to `url`. */
  renameToSite: (id: string, url: string) => void;
  /** Move the window `fromId` to just before/after the window `toId`. */
  reorder: (fromId: string, toId: string, position: DropPosition) => void;
  /** Put the window `id` on the stage. */
  select: (id: string) => void;
  /**
   * Take the window `id` out of the rail to float over the stage, or put it
   * back if it is already out.
   *
   * One call rather than two because it answers one keystroke: Alt+Tab is a
   * toggle, and which way it goes is a fact about the window the shell already
   * holds rather than something the caller should have to look up.
   */
  toggleFloat: (id: string) => void;
};

/**
 * The shell's windows, and everything that changes them.
 *
 * The host's lifecycle events (a client appeared, a client is gone) are the
 * other half of the user's own actions, so both go through one reducer and the
 * chrome renders a single list — and so does everything a client says about its
 * own window, because a window's size and its cursor are facts about it in
 * exactly the way its title is. A client's *pixels* are the one thing that does
 * not come through here, and they do not come through the page at all: the
 * compositor submits the client's buffer and the portal embeds the surface.
 */
export const useWindows = (domicile: DomicileClient): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);

  useEffect(() => {
    domicile.on("app_appeared", ({ app_id, size, title }) => {
      dispatch(WindowAction.AppAppeared(app_id, title));
      // A size here is a client that has committed a buffer already — the
      // replay a reloading chrome is given — and it says the same thing
      // `app_resized` does, so it is reduced the same way. A window that has
      // only just mapped carries none, and there is nothing to record.
      if (size !== undefined) {
        dispatch(WindowAction.AppDrewAt(app_id, size));
      }
    });
    domicile.on("app_titled", ({ app_id, title }) => {
      dispatch(WindowAction.AppTitled(app_id, title));
    });
    domicile.on("app_closed", ({ app_id }) => {
      dispatch(WindowAction.AppClosed(app_id));
    });
    domicile.on("app_resized", ({ app_id, size }) => {
      dispatch(WindowAction.AppDrewAt(app_id, size));
    });
    domicile.on("app_cursor", ({ app_id, cursor }) => {
      dispatch(WindowAction.AppCursorChanged(app_id, cursor));
    });
    domicile.on("focus_changed", ({ app_id }) => {
      dispatch(WindowAction.FocusChanged(app_id));
    });
    domicile.on("focus_requested", ({ app_id }) => {
      // A client asking, which the compositor forwards without granting — so
      // what happens next is `reduceWindows`'s to say and not the desktop's.
      dispatch(WindowAction.FocusRequested(app_id));
    });
  }, [domicile]);

  const close = useCallback(
    (id: string) => {
      const appId = appIdOf(id);
      if (appId === undefined) {
        dispatch(WindowAction.WindowClosed(id));
      } else {
        // Nothing here ends a client: the compositor sends its toplevel a
        // close, and an editor with unsaved work is entitled to stay. What
        // takes the tab away is the `app_closed` that follows if it goes.
        domicile.closeApp(appId);
      }
    },
    [domicile],
  );

  const openBrowser = useCallback(() => {
    dispatch(WindowAction.BrowserOpened(HOME_PAGE));
  }, []);

  const openTerminal = useCallback(() => {
    domicile.spawn(TERMINAL_COMMAND);
  }, [domicile]);

  const renameToSite = useCallback((id: string, url: string) => {
    dispatch(WindowAction.WindowRenamed(id, siteOf(url)));
  }, []);

  const reorder = useCallback(
    (fromId: string, toId: string, position: DropPosition) => {
      dispatch(WindowAction.WindowsReordered(fromId, toId, position));
    },
    [],
  );

  const select = useCallback((id: string) => {
    dispatch(WindowAction.WindowSelected(id));
  }, []);

  const grab = useCallback((id: string) => {
    dispatch(WindowAction.WindowGrabbed(id));
  }, []);

  const drop = useCallback(() => {
    dispatch(WindowAction.WindowDropped());
  }, []);

  const move = useCallback((id: string, x: number, y: number) => {
    dispatch(WindowAction.WindowMoved(id, x, y));
  }, []);

  const resize = useCallback((id: string, width: number, height: number) => {
    dispatch(WindowAction.WindowResized(id, width, height));
  }, []);

  const toggleFloat = useCallback(
    (id: string) => {
      dispatch(
        floatingOf(state.floats, id) === undefined
          ? WindowAction.WindowFloated(id)
          : WindowAction.WindowTabbed(id),
      );
    },
    [state.floats],
  );

  return useMemo(
    () => ({
      ...state,
      close,
      drop,
      grab,
      move,
      openBrowser,
      openTerminal,
      renameToSite,
      reorder,
      resize,
      select,
      toggleFloat,
    }),
    [
      close,
      drop,
      grab,
      move,
      openBrowser,
      openTerminal,
      renameToSite,
      reorder,
      resize,
      select,
      state,
      toggleFloat,
    ],
  );
};
