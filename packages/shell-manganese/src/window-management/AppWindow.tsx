import { APP_FOCUS_REQUESTED_EVENT } from "@domicile/chrome-sdk/app-element";
import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import { useEffect, useState } from "react";

import { css, cx } from "../../styled-system/css";
import { surfaceBox } from "./floating/float";
import type { Floating } from "./window-state";
import {
  clickThroughStyles,
  draggingStyles,
  floatEdgeStyles,
  floatPlacement,
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
  /** The channel the keyboard is asked for over. */
  domicile: DomicileClient;
  /** How this window floats over the stage, or `undefined` while it is on it. */
  floating: Floating | undefined;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * Called when the user clicks into this window.
   *
   * The SDK would move the keyboard here by itself — a click on a client's
   * window is a request for it, and left alone the SDK grants one. This shell
   * takes that back: which window the user is working in is one fact with one
   * owner, and a keyboard that moved without the shell saying so is the rail
   * highlighting one window while another is typed into.
   */
  onReach: () => void;
  /**
   * Whether this window is on screen at all.
   *
   * Not the same as being focused: a floating window is on screen whatever
   * else the user is doing, and a tabbed one is on screen only while its tab
   * is the selected one.
   */
  onScreen: boolean;
};

/**
 * A Wayland client's window: one `<app>`, which is the whole point of
 * Domicile — the client's live pixels are a real element that takes ordinary
 * CSS. Hiding is what takes it off the stage: a hidden element has no box, so
 * the SDK reports it to the host as no longer composited.
 *
 * The element is the engine's rather than the SDK's, so what this component
 * writes onto it is ordinary DOM: an attribute for which window, a class and a
 * style for where and how it is drawn, and `cursor` among the style because
 * that is what a cursor always was.
 *
 * Two things are not props, and for the same reason — `<app>` has no hyphen in
 * its name, so React treats the tag as an ordinary HTML element rather than as a
 * custom element, and neither a property it does not recognise nor an `on…`
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
  domicile,
  dragging,
  floating,
  focused,
  onReach,
  onScreen,
}: Props) => {
  // `null` rather than `undefined` because that is what React's ref API hands a
  // callback ref on unmount.
  const [element, setElement] = useState<HTMLAppElement | null>(null);

  // Only that way round, which is why this is not `focused ? … : …`. Which
  // client holds the keyboard is one seat's answer and something is always in
  // it: "this window has it" is an instruction the compositor can carry out, and
  // "this window does not" is not one. The keyboard leaves here when another
  // window takes it or when a click lands on the chrome, both of which say where
  // it went — so rendering `false` says nothing.
  useEffect(() => {
    if (focused) {
      focusApp(domicile, appId);
    }
  }, [appId, domicile, focused]);

  // A click on a client's window asks for the keyboard, and the SDK grants it
  // unless something answers first. This answers first: the request becomes the
  // shell's to decide, and `focused` above is what carries the decision back to
  // the same element a render later.
  useEffect(() => {
    if (element === null) {
      return undefined;
    } else {
      const asked = (event: Event) => {
        // Unconditionally, and before the branch below: the keyboard stays where
        // the shell put it whether or not this particular click moves anything,
        // which is the difference between a shell that owns focus and one that
        // owns it except where it agrees with the SDK.
        event.preventDefault();
        // The window the user is already in has nothing to report: it would be
        // asking the shell to reach what it has just reached, on every press.
        if (!focused) {
          onReach();
        }
      };
      element.addEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      return () => {
        element.removeEventListener(APP_FOCUS_REQUESTED_EVENT, asked);
      };
    }
  }, [element, focused, onReach]);

  return (
    <app
      app-id={appId}
      className={cx(
        windowStyles,
        appStyles,
        clickThrough && clickThroughStyles,
        dragging && draggingStyles,
        floating !== undefined && framedStyles,
        floating !== undefined && floatEdgeStyles,
      )}
      hidden={!onScreen}
      ref={setElement}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. The cursor is inline for a
      // different reason: it is a value a client sends, so no build-time rule
      // could name it. `undefined` on either leaves the window filling the stage
      // with the page's own cursor over it.
      style={{
        cursor,
        ...(floating === undefined
          ? undefined
          : floatPlacement(surfaceBox(floating.float), floating.depth)),
      }}
    />
  );
};

const appStyles = css({
  // Rounded by the compositor, not by the browser: this element is a hole in
  // the page and has no pixels of its own to clip. The SDK reports the radius
  // with the placement and the compositor's shader applies it to the client's
  // own buffer, which is why a window can be round at all without a copy. A
  // length rather than a percentage on purpose: the computed value keeps the
  // `%`, and the number in front of it would be read as pixels.
  borderRadius: "lg",
});

// A floating window's corners are the frame's, not its own. Square, because
// the compositor's shader takes one radius for all four — it is the element's
// `border-top-left-radius` the SDK reports — so a window cannot be square
// under its bar and round at the bottom. The bar carries the rounding, and the
// surface under it meets it flush.
const framedStyles = css({ borderBlockStartWidth: 0, borderRadius: 0 });
