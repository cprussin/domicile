import type { AppFocusReleaseRequest } from "@domicile-desktop/sdk/app-element";
import {
  APP_FOCUS_RELEASE_REQUESTED_EVENT,
  APP_FOCUS_REQUESTED_EVENT,
} from "@domicile-desktop/sdk/app-element";
import type { CursorShape } from "@domicile-desktop/sdk/cursor-shape";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { focusApp } from "@domicile-desktop/sdk/focus-app";
import { focusChrome } from "@domicile-desktop/sdk/focus-chrome";
import { useEffect, useState } from "react";

import { css, cx } from "../../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import { appWindowId } from "./window";
import type { WindowMotion } from "./window-motion";
import { isLeaving } from "./window-motion";
import {
  bottomCornerStyles,
  clickThroughStyles,
  draggingStyles,
  edgeStyles,
  focusedEdgeStyles,
  movingStyles,
  placedAt,
  restingEdgeStyles,
  scaledAbout,
  settlingStyles,
  shuffledBy,
  windowStyles,
} from "./window-styles";

type Props = {
  /**
   * Whether it is all the desk shows, alone or as a tab group — see
   * `showsOneThing` — which leaves its frame the resting color even while it
   * is focused: there is nothing else for it to be picked out from.
   */
  alone?: boolean;
  /**
   * Whether a panel of the desktop's own is up over the windows.
   *
   * Which is a thing to type into that no click reached and no client knows
   * about, so the seat is the page's for as long as it is there — see the
   * effect that answers this.
   */
  behindPanel: boolean;
  /**
   * Whether the pointer goes through this window to the page behind it.
   *
   * What lets the shell drag a window at all: the pointer over a client's
   * surface belongs to the client, so the shell has to be given it back
   * before it can be told where the window is being dragged to.
   */
  clickThrough: boolean;
  /** Whether the user has hold of this window, which makes it see-through. */
  dragging: boolean;
  /** The host's name for the client this window shows. */
  appId: string;
  /**
   * The cursor the client has asked for, or `undefined` while it has asked for
   * none — which leaves the pointer whatever the page's own styling says.
   */
  cursor: CursorShape | undefined;
  /** How it stacks: the window's own `z-index`, which the SDK reports. */
  depth: number;
  /** The channel the keyboard is asked for over. */
  domicile: DomicileClient;
  /**
   * The whole box this window's bar and contents span, which both of them turn
   * about — see {@link scaledAbout}. `undefined` for a window that is not on
   * screen, exactly as {@link Props.rect} is.
   */
  frame: Rect | undefined;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * Whether this window fills the screen, which squares its corners and drops
   * its edge: the screen's own are the only ones it has.
   */
  fullscreen: boolean;
  /**
   * Whether the compositor says this window is the one it is typing into.
   *
   * Not the same fact as {@link Props.focused}, which is the shell's own, and
   * the difference is the whole reason this is a prop: the two come apart
   * whenever something takes the keyboard without the shell saying so.
   */
  hasKeyboard: boolean;
  /**
   * What this window is doing that the page has to draw over time: arriving,
   * leaving, or nothing at all.
   *
   * A window that is leaving is drawn and nothing else. It asks for no
   * keyboard, takes no pointer and is nothing a keyboard can reach, because
   * what it is showing is where the window was rather than a window.
   */
  motion: WindowMotion;
  /**
   * Called when it has played that motion all the way out.
   *
   * Which is how the desktop knows a window it has closed can be taken off the
   * page. Rather than a timer: how long the motion takes is the stylesheet's,
   * and a duration written in the shell as well is a second copy of it to keep
   * in step.
   */
  onMotionEnded: () => void;
  /**
   * Where the window's contents go, or `undefined` when it is not on screen
   * at all — on another workspace, or inside a container behind a tab.
   */
  rect: Rect | undefined;
  /**
   * The shuffle it is playing while it trades places with another float in
   * the stack — see `shuffledBy` — or `undefined` while it is not.
   */
  restack?: Restack | undefined;
};

/**
 * A Wayland client's window: one `<app>`, which is the whole point of
 * Domicile — the client's live pixels are a real element that takes ordinary
 * CSS. Hiding is what takes it off the screen: a hidden element has no box, so
 * the SDK reports it to the host as no longer composited.
 *
 * The element is the engine's rather than the SDK's, so what this component
 * writes onto it is ordinary DOM: an attribute for which window, a class and a
 * style for where and how it is drawn, and `cursor` among the style because
 * that is what a cursor always was.
 *
 * Two things are not props, and for the same reason — `<app>` has no hyphen in
 * its name, so React treats the tag as an ordinary HTML element rather than as a
 * custom element, and neither a property it does not recognize nor an `on…`
 * listener for an event it has never heard of is written at all. So the focus
 * request is bound with `addEventListener` — the way `BrowserWindow` binds
 * `<webview>`'s events, for the same reason — and the keyboard is asked for in
 * an effect. The keyboard could not have been a property anyway: a client is a
 * surface, with nowhere for the browser to put focus.
 */
export const AppWindow = ({
  alone = false,
  appId,
  behindPanel,
  clickThrough,
  cursor,
  depth,
  domicile,
  dragging,
  focused,
  frame,
  fullscreen,
  hasKeyboard,
  motion,
  onMotionEnded,
  rect,
  restack,
}: Props) => {
  // A window the desktop no longer has is being drawn and nothing else.
  const leaving = isLeaving(motion);
  // `null` rather than `undefined` because that is what React's ref API hands a
  // callback ref on unmount.
  const [element, setElement] = useState<HTMLAppElement | null>(null);

  // Only that way round, which is why this is not `focused ? … : …`. Which
  // client holds the keyboard is one seat's answer and something is always in
  // it: "this window has it" is an instruction the compositor can carry out, and
  // "this window does not" is not one — so rendering `false` says nothing.
  //
  // Said again whenever the compositor answers with somewhere else, which is
  // what `hasKeyboard` is for. The shell's idea of the active window and the
  // seat come apart on their own: a press on the top bar, on the wallpaper, on
  // anything of the chrome's hands the keyboard back to the page, and the
  // window being worked in has not changed — so nothing else the shell watches
  // moves, and before this the divergence was permanent. The desktop went on
  // drawing a window as focused that every keystroke was missing.
  //
  // It cannot loop. A `focusApp` the compositor carries out comes back as the
  // `focus_changed` that makes this false, and one it refuses moves neither
  // this nor `focused`, so the effect is not run again either way.
  //
  // And not for a window that is leaving. Its bar goes on saying the keyboard
  // was in it — that is what stops a window changing while the user watches it
  // go — but the keyboard itself has moved on to whatever is left, and asking
  // again would take it back off the window the user is now working in.
  //
  // AND IT WAITS WHILE A PANEL OF THE DESKTOP'S OWN IS OVER IT. The launcher
  // is drawn by the page and the keyboard is the compositor's, so a client
  // left holding the seat goes on receiving every keystroke while the user
  // types into a box on top of it: the box fills with nothing and the window
  // underneath takes the letters. The clause above is what would undo any
  // attempt to fix that elsewhere — it asks for the seat back the moment the
  // compositor says the keyboard has moved — so this is the same rule with
  // the panel in it rather than a second rule fighting it.
  //
  // The give-back is the same line read the other way. When the panel goes
  // down the seat is still the page's and the window is still the one being
  // worked in, so the clause below runs and puts it back — without waiting
  // for the pointer to cross the window, which under focus-follows-cursor
  // might be the next thing the user does or might be minutes away.
  useEffect(() => {
    if (behindPanel) {
      if (hasKeyboard) {
        focusChrome(domicile);
      }
    } else if (focused && !hasKeyboard && !leaving) {
      focusApp(domicile, appId);
    }
  }, [appId, behindPanel, domicile, focused, hasKeyboard, leaving]);

  // A click on a client's window asks for the keyboard, and the SDK grants it
  // unless something answers first. This answers first, and unconditionally:
  // which window the user is working in is one fact with one owner, and the
  // press that asked is the frame's to report — see `WindowFrame`. `focused`
  // above is what carries the decision back to the same element a render
  // later.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const asked = (event: Event) => {
        event.preventDefault();
      };
      element.addEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      return () => {
        element.removeEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      };
    }
  }, [element]);

  // And the other direction. The SDK gives the keyboard back to the page for a
  // press that lands off every `<app>`, which a float's own title bar and grab
  // sheet do — so without this, taking hold of a window to move it took the
  // keyboard off it. Nothing in the press says which window a `<div>` belongs
  // to, which is why the chrome says so on itself and this reads it back.
  //
  // The nearest marked ancestor rather than a selector built from the id: an
  // app id is a client's to choose, and one with a quote in it would be a
  // selector that throws in the middle of a press.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const releasing = (event: Event) => {
        const { pressed } = (event as CustomEvent<AppFocusReleaseRequest>)
          .detail;
        const chrome = pressed?.closest("[data-window]");
        if (chrome?.getAttribute("data-window") === appWindowId(appId)) {
          event.preventDefault();
        }
      };
      element.addEventListener(APP_FOCUS_RELEASE_REQUESTED_EVENT, releasing);
      return () => {
        element.removeEventListener(
          APP_FOCUS_RELEASE_REQUESTED_EVENT,
          releasing,
        );
      };
    }
  }, [appId, element]);

  return (
    <app
      app-id={appId}
      className={cx(
        windowStyles,
        appStyles,
        // Neither a line nor rounded corners around the screen's own edge.
        !fullscreen && edgeStyles,
        !fullscreen && bottomCornerStyles,
        movingStyles({ motion }),
        // The frame says what the bar above it says: this is the window the
        // keyboard is in.
        focused && !alone ? focusedEdgeStyles : restingEdgeStyles,
        (clickThrough || leaving) && clickThroughStyles,
        // A dragged window is written at a new box on every pointer move, so
        // it takes the box it is given rather than easing towards it. Its
        // colors go on easing either way — see `settlingStyles`.
        dragging && draggingStyles,
        settlingStyles({ dragging }),
      )}
      // What it is doing, as an attribute as well as an animation: the
      // desktop's own state is worth being able to read off the element.
      data-motion={motion}
      hidden={rect === undefined}
      // Nothing a keyboard can reach, for as long as it is only being drawn.
      inert={leaving}
      // Its own rather than one of the chrome's on its way up the document:
      // a window is told it has finished when *it* has.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          onMotionEnded();
        }
      }}
      ref={setElement}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. The cursor is inline for a
      // different reason: it is a value a client sends, so no build-time rule
      // could name it. `undefined` on either leaves the window unplaced and
      // hidden, with the page's own cursor over it.
      style={{
        cursor,
        ...(rect === undefined || frame === undefined
          ? undefined
          : {
              ...placedAt(rect, depth),
              ...scaledAbout(frame, rect),
              ...shuffledBy(restack),
            }),
      }}
    />
  );
};

// The bar carries the edge above it, and the surface meets it flush.
const appStyles = css({ borderBlockStartWidth: 0 });
