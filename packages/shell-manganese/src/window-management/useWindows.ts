import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import { editorCommand } from "../launcher/editor-command";
import { appIdOf } from "./window";
import type { WindowAction, WindowState } from "./window-state";
import {
  WindowAction as Action,
  activeIdOf,
  NO_WINDOWS,
  reduceWindows,
  WindowActionKind,
} from "./window-state";
import { windowsOn } from "./workspace";

/** What the terminal launcher asks the compositor to run. */
const TERMINAL_COMMAND = ["kitty"] as const;

export type Windows = WindowState & {
  /**
   * Ask the desktop for something — a keystroke's command, or a press on the
   * chrome.
   *
   * One entry point rather than one callback per command, because the
   * bindings are a table of exactly these: what a key does is data, and this
   * is what runs it. The two things the *state* cannot do on its own happen
   * here as well — see the `kill` and the terminal below.
   */
  act: (action: WindowAction) => void;
  /** The window the user is working in, floating or tiled. */
  activeId: string | undefined;
  /** The workspaces with something on them, which is what the bar shows. */
  occupied: readonly string[];
};

/**
 * The desktop's windows, and everything that changes them.
 *
 * The host's lifecycle events (a client appeared, a client is gone) are the
 * other half of the user's own commands, so both go through one reducer — and
 * so does the cursor a client asks for, because that is a fact about its
 * window in exactly the way its title is, and because a cursor is CSS on an
 * element this shell owns.
 *
 * Two things a client says about itself do not come through here. Its *pixels*
 * do not come through the page at all: the compositor submits its buffer and
 * the `<app>` element embeds the surface. And the size it drew at is the
 * SDK's, because scaling the pointer by it is the only use anyone has for it.
 */
export const useWindows = (domicile: DomicileClient): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);

  useEffect(() => {
    // The size an announcement can carry is not read here, and there is no
    // `app_resized` handler below either. What a client drew at is only ever an
    // input to the SDK's pointer arithmetic, and the SDK records it as the
    // message goes past `DomicileClient` — this shell was carrying a fact it had
    // no other use for.
    domicile.on("app_appeared", ({ app_id, title }) => {
      dispatch(Action.AppAppeared(app_id, title));
    });
    domicile.on("app_titled", ({ app_id, title }) => {
      dispatch(Action.AppTitled(app_id, title));
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
      // A client asking, which the compositor forwards without granting — so
      // what happens next is `reduceWindows`'s to say and not the desktop's.
      dispatch(Action.FocusRequested(app_id));
    });
  }, [domicile]);

  const act = useCallback(
    (action: WindowAction) => {
      dispatch(action);
      // And the two asks the state cannot make itself. A terminal is a process
      // the compositor starts; a client's window is the client's to close, so
      // the compositor sends its toplevel a close and the window goes when the
      // host says it went. Both are still actions, so that the bindings stay
      // one table and the reduction stays pure.
      if (action.kind === WindowActionKind.TerminalLaunched) {
        domicile.spawn(TERMINAL_COMMAND);
      }
      // The launcher's other half. `editorCommand` is where the argv is built
      // and why it has a shell in it: `$EDITOR` and `$HOME` live in the
      // process the compositor starts, not in a page served over
      // `domicile://`.
      if (action.kind === WindowActionKind.EditorLaunched) {
        domicile.spawn(editorCommand(action.path));
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

  return useMemo(
    () => ({
      ...state,
      act,
      activeId: activeIdOf(state),
      occupied: state.workspaces
        .filter((workspace) => windowsOn(workspace).length > 0)
        .map(({ name }) => name),
    }),
    [act, state],
  );
};
