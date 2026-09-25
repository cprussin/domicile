import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Display } from "@domicile/component-library/display-source";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { editorCommand } from "../launcher/editor-command";
import type { DeskChannel } from "./desk-channel";
import { DeskMessage } from "./desk-channel";
import { appIdOf } from "./window";
import type { WindowAction, WindowState } from "./window-state";
import {
  WindowAction as Action,
  activeIdOf,
  NO_WINDOWS,
  reduceWindows,
  WindowActionKind,
} from "./window-state";

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
};

/**
 * Whether this page is the one that reduces the desktop, or `undefined`
 * before it has been told a desk at all.
 *
 * **NOT NEGOTIATED, BECAUSE IT DOES NOT HAVE TO BE.** Every page is told the
 * whole desk with its own display marked — the one it covers is the one
 * carrying `scanout` — so the first display is the same display on every page
 * and the page whose window covers it is the same page to all of them. An
 * election over the channel would be a second answer to a question the desk
 * already answers.
 *
 * A page that covers no display at all is a page that IS the desktop — a
 * nested run, a plain browser — so it is the only page there is and it leads.
 *
 * `undefined` is the beat before the handshake is answered. There is no desk
 * to read a leader off, and no screen to draw a window on either, so every
 * page reduces what it hears and none of them says anything: the pages hear
 * the same events in the same order, so they agree without being told.
 */
export const leadsTheDesk = (
  displays: readonly Display[] | undefined,
): boolean | undefined => {
  const first = displays?.[0];
  if (first === undefined) {
    return undefined;
  } else {
    const own = displays?.find((display) => display.scanout !== undefined);
    return own === undefined || own.name === first.name;
  }
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
 *
 * **ONE REDUCER FOR THE WHOLE DESK, WHICHEVER PAGE IT IS IN.** A desk of
 * several monitors is several pages of this shell and one desktop between
 * them: the workspaces span the monitors, a window opens on the screen the
 * keyboard is on, and every bar shows which workspaces have something on them.
 * So the page that covers the first screen reduces, and the others ask it to
 * and show what it says — `desk-channel.ts` is the whole of that, and
 * {@link leadsTheDesk} is who does which.
 *
 * @param displays - the desk the host described, which says which page this
 *   is. `undefined` until it has described one.
 * @param desk - the other pages of this desk, which is a connection and so is
 *   passed in rather than made here — the same reason `displays` is.
 */
export const useWindows = (
  domicile: DomicileClient,
  displays: readonly Display[] | undefined,
  desk: DeskChannel,
): Windows => {
  const [state, dispatch] = useReducer(reduceWindows, NO_WINDOWS);
  const leads = leadsTheDesk(displays);

  // Read where it is spent rather than closed over: the host's handlers are
  // registered once per client and a monitor plugged in must not re-register
  // them, and what a page does with what it hears changes the moment it stops
  // being the page that reduces.
  const reducing = useRef(leads !== false);
  reducing.current = leads !== false;

  // The desktop as of this render, for the same reason: what a page that has
  // just come up is told is whatever the desktop is when it asks, and the
  // answer is written by a listener registered once.
  const latest = useRef(state);
  latest.current = state;

  // Everything the state cannot do itself: a terminal is a process the
  // compositor starts, and a client's window is the client's to close — the
  // compositor sends its toplevel a close and the window goes when the host
  // says it went. Both are still actions, so that the bindings stay one table
  // and the reduction stays pure.
  const run = useCallback(
    (action: WindowAction) => {
      dispatch(action);
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
  const running = useRef(run);
  running.current = run;

  useEffect(() => {
    // The size an announcement can carry is not read here, and there is no
    // `app_resized` handler below either. What a client drew at is only ever an
    // input to the SDK's pointer arithmetic, and the SDK records it as the
    // message goes past `DomicileClient` — this shell was carrying a fact it had
    // no other use for.
    //
    // HEARD BY EVERY PAGE AND REDUCED BY ONE. The compositor broadcasts these
    // to every window of the desk, so a page that is not the one reducing
    // would be making its own second desktop out of them — and a window laid
    // out on two pages is a window embedded twice, which takes its pixels away
    // from the page that had it.
    const told = (action: WindowAction) => {
      if (reducing.current) {
        dispatch(action);
      }
    };
    domicile.on("app_appeared", ({ app_id, title }) => {
      told(Action.AppAppeared(app_id, title));
    });
    domicile.on("app_titled", ({ app_id, title }) => {
      told(Action.AppTitled(app_id, title));
    });
    domicile.on("app_closed", ({ app_id }) => {
      told(Action.AppClosed(app_id));
    });
    domicile.on("app_cursor", ({ app_id, cursor }) => {
      told(Action.AppCursorChanged(app_id, cursor));
    });
    domicile.on("focus_changed", ({ app_id }) => {
      told(Action.FocusChanged(app_id));
    });
    domicile.on("focus_requested", ({ app_id }) => {
      // A client asking, which the compositor forwards without granting — so
      // what happens next is `reduceWindows`'s to say and not the desktop's.
      told(Action.FocusRequested(app_id));
    });
  }, [domicile]);

  // The desk the host described, which is what says where a window can be.
  // Reduced by the page that reduces, like everything else: the others are
  // told the same desk and would only reach the same answer a beat earlier.
  useEffect(() => {
    if (displays !== undefined && reducing.current) {
      dispatch(Action.ScreensDescribed(displays.map(({ name }) => name)));
    }
  }, [displays]);

  // What the other pages say, and what they are told.
  useEffect(() => {
    const stop = desk.listen((message) => {
      switch (message.type) {
        case "acted": {
          // A press on another monitor's chrome, or a key read by the page
          // that does not reduce. Run here or nowhere.
          if (reducing.current) {
            running.current(message.action);
          }
          break;
        }
        case "asked": {
          if (reducing.current) {
            desk.post(DeskMessage.Desk(latest.current));
          }
          break;
        }
        case "desk": {
          // Whatever this page thought, the page that reduces has said. A
          // page that has just stopped reducing takes this too, which is what
          // makes a monitor unplugged out from under the desktop survivable.
          if (!reducing.current) {
            dispatch(Action.DeskAdopted(message.desk));
          }
          break;
        }
      }
    });
    // Asked on every page, including the one that answers: a page that leads
    // hears nothing back from itself, which is the answer that there was
    // nothing to catch up with.
    desk.post(DeskMessage.Asked());
    return stop;
  }, [desk]);

  // Said rather than only asked for: a page that answered `asked` and nothing
  // else would leave the other monitors on the desktop as it was when they
  // came up.
  useEffect(() => {
    if (leads === true) {
      desk.post(DeskMessage.Desk(state));
    }
  }, [desk, leads, state]);

  const act = useCallback(
    (action: WindowAction) => {
      if (reducing.current) {
        running.current(action);
      } else {
        desk.post(DeskMessage.Acted(action));
      }
    },
    [desk],
  );

  return useMemo(
    () => ({
      ...state,
      act,
      activeId: activeIdOf(state),
    }),
    [act, state],
  );
};
