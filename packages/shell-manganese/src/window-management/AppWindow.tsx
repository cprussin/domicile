import type { AppFocusReleaseRequest } from "@domicile/chrome-sdk/app-element";
import {
  APP_FOCUS_RELEASE_REQUESTED_EVENT,
  APP_FOCUS_REQUESTED_EVENT,
} from "@domicile/chrome-sdk/app-element";
import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import { useEffect, useState } from "react";

import { css, cx } from "../../styled-system/css";
import type { Rect } from "./rect";
import { appWindowId } from "./window";
import {
  clickThroughStyles,
  draggingStyles,
  edgeStyles,
  placedAt,
  windowStyles,
} from "./window-styles";

type Props = {
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
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * Whether the compositor says this window is the one it is typing into.
   *
   * Not the same fact as {@link Props.focused}, which is the shell's own, and
   * the difference is the whole reason this is a prop: the two come apart
   * whenever something takes the keyboard without the shell saying so.
   */
  hasKeyboard: boolean;
  /**
   * Called when the pointer moves into this window.
   *
   * Focus follows the cursor in this shell, so arriving over a window is the
   * user starting to work in it. The pointer over a client's surface belongs
   * to the client, and this is not that question: the page hit-tests the
   * element to decide who the pointer is for, so it knows the pointer is here
   * whether or not the client is about to be sent it.
   */
  onHover: () => void;
  /**
   * Called when the user clicks into this window.
   *
   * The SDK would move the keyboard here by itself — a click on a client's
   * window is a request for it, and left alone the SDK grants one. This shell
   * takes that back: which window the user is working in is one fact with one
   * owner, and a keyboard that moved without the shell saying so is one
   * window's title bar drawn as focused while another is typed into.
   */
  onReach: () => void;
  /**
   * Where the window's contents go, or `undefined` when it is not on screen
   * at all — on another workspace, or behind another window's tab.
   */
  rect: Rect | undefined;
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
  appId,
  clickThrough,
  cursor,
  depth,
  domicile,
  dragging,
  focused,
  hasKeyboard,
  onHover,
  onReach,
  rect,
}: Props) => {
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
  useEffect(() => {
    if (focused && !hasKeyboard) {
      focusApp(domicile, appId);
    }
  }, [appId, domicile, focused, hasKeyboard]);

  // A click on a client's window asks for the keyboard, and the SDK grants it
  // unless something answers first. This answers first: the request becomes the
  // shell's to decide, and `focused` above is what carries the decision back to
  // the same element a render later.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const asked = (event: Event) => {
        // Unconditionally: the keyboard stays where the shell put it whether or
        // not this particular click moves anything, which is the difference
        // between a shell that owns focus and one that owns it except where it
        // agrees with the SDK.
        event.preventDefault();
        // And every press is reported, including one in the window the user is
        // already in. Focus follows the cursor here, so the pointer has made
        // this the active window before the press lands — a window that
        // answered only the presses that found it inactive could never be
        // raised by a click. The reduction is what keeps that from re-rendering
        // the desktop: a reach that moves nothing returns the state it was
        // given.
        onReach();
      };
      element.addEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      return () => {
        element.removeEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      };
    }
  }, [element, onReach]);

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
        edgeStyles,
        clickThrough && clickThroughStyles,
        dragging && draggingStyles,
      )}
      hidden={rect === undefined}
      // React's own event rather than a listener on the ref: `pointerover` is
      // one it has heard of, unlike the two the SDK invented above. It rather
      // than `pointerenter` because it is the one the page is actually given —
      // an `<app>` is a replaced element with no rendered children, so nothing
      // distinguishes the two here anyway.
      onPointerOver={onHover}
      ref={setElement}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. The cursor is inline for a
      // different reason: it is a value a client sends, so no build-time rule
      // could name it. `undefined` on either leaves the window unplaced and
      // hidden, with the page's own cursor over it.
      style={{
        cursor,
        ...(rect === undefined ? undefined : placedAt(rect, depth)),
      }}
    />
  );
};

// Every window's corners are its frame's rather than its own, and square: the
// compositor's shader takes one radius for all four — it is the element's
// `border-top-left-radius` the SDK reports — so a window cannot be square
// under its bar and round at the bottom. The bar carries the edge above it,
// and the surface meets it flush.
const appStyles = css({ borderBlockStartWidth: 0 });
