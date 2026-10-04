import type { Display } from "@domicile-desktop/component-library/display-source";
import type {
  DomicileHost,
  DomicileWindow,
} from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { openCommand } from "../launcher/open-command";
import type { PlacedScreen } from "../screens/screen-toward";
import { appIdOf } from "./window";
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
   * Ask the desktop for something — a keystroke's command, or a press on the
   * chrome.
   *
   * One entry point rather than one callback per command, because the
   * bindings are a table of exactly these: what a key does is data, and this
   * is what runs it. The two things the *state* cannot do on its own happen
   * here as well — see the `kill` and the `exec` below.
   */
  act: (action: WindowAction) => void;
  /** The window the user is working in, floating or tiled. */
  activeId: string | undefined;
};

/**
 * The desktop's windows, and everything that changes them.
 *
 * The host's windows (a client appeared, a client is gone) are the other half
 * of the user's own commands, so both go through one reducer — and
 * so does the cursor a client asks for, because that is a fact about its
 * window in exactly the way its title is, and because a cursor is CSS on an
 * element this shell owns.
 *
 * Two things a client says about itself do not come through here. Its *pixels*
 * do not come through the page at all: the compositor submits its buffer and
 * the `<app>` element embeds the surface. And the size it drew at is the
 * SDK's, because scaling the pointer by it is the only use anyone has for it.
 *
 * @param displays - the desk the host described. `undefined` until it has
 *   described one.
 */
export const useWindows = (
  domicile: DomicileHost,
  displays: readonly Display[] | undefined,
): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);

  // Everything the state cannot do itself: an `exec` is a process the
  // compositor starts, the lock is the compositor's, and a client's window is the client's to close — the
  // compositor sends its toplevel a close and the window goes when the host
  // says it went. Both are still actions, so that the bindings stay one table
  // and the reduction stays pure.
  const act = useCallback(
    (action: WindowAction) => {
      dispatch(action);
      if (action.kind === WindowActionKind.CommandExecuted) {
        domicile.spawn(action.argv);
      }
      if (action.kind === WindowActionKind.DeskLocked) {
        domicile.lock();
      }
      // The launcher's other half. `openCommand` is where the argv is built
      // and why it has a shell in it: `$HOME` lives in the process the
      // compositor starts, not in a page served over `domicile://`.
      if (action.kind === WindowActionKind.FileOpened) {
        domicile.spawn(openCommand(action.path));
      }
      if (action.kind === WindowActionKind.AppLaunched) {
        domicile.spawn(action.command);
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
      }
    },
    [domicile, state],
  );

  // The windows the host listed last, which the next list is told against.
  // A ref rather than effect-local, so a listener made again does not
  // announce every window a second time.
  const listed = useRef<readonly DomicileWindow[]>([]);

  useEffect(() => {
    // What a client drew at is not read here: it is only ever an input to
    // the SDK's pointer arithmetic, which reads it off `domicile.windows`.
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
    // A client asking, which the compositor forwards without granting — so
    // what happens next is `reduceWindows`'s to say and not the desktop's.
    const focusRequested = ({ appId }: { appId: string }) => {
      dispatch(Action.FocusRequested(appId));
    };
    // `domicile open-url`, which is what `BROWSER` runs inside the desktop.
    const openUrl = ({ url }: { url: string }) => {
      dispatch(Action.BrowserOpened(url));
    };
    windowsChanged();
    focusChanged();
    domicile.addEventListener("windowschanged", windowsChanged);
    domicile.addEventListener("focusedwindowchanged", focusChanged);
    domicile.addEventListener("focusrequested", focusRequested);
    domicile.addEventListener("openurl", openUrl);
    return () => {
      domicile.removeEventListener("windowschanged", windowsChanged);
      domicile.removeEventListener("focusedwindowchanged", focusChanged);
      domicile.removeEventListener("focusrequested", focusRequested);
      domicile.removeEventListener("openurl", openUrl);
    };
  }, [domicile]);

  // The desk the host described, which is what says where a window can be.
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
