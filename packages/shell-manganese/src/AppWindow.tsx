import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import { APP_FOCUS_REQUESTED_EVENT } from "@domicile/chrome-sdk/app-element";
import { useEffect, useState } from "react";

import { css, cx } from "../styled-system/css";
import type { AppElements } from "./app-elements";
import { surfaceBox } from "./float";
import type { Floating } from "./shell-state";
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
  appElements: AppElements;
  /** The host's name for the client this portal shows. */
  appId: string;
  /** How this window floats over the stage, or `undefined` while it is on it. */
  floating: Floating | undefined;
  /** Whether the user is working in this window, so it takes the keyboard. */
  focused: boolean;
  /**
   * Called when the user clicks into this window.
   *
   * The SDK would move the keyboard here by itself — a click on a client's
   * window is a request for it, and left alone the element grants one. This
   * shell takes that back: which window the user is working in is one fact
   * with one owner, and a keyboard that moved without the shell saying so is
   * the rail highlighting one window while another is typed into.
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
 * A Wayland client's window: one `<domicile-app>` portal, which is the whole
 * point of Domicile — the client's live pixels are a real element that takes
 * ordinary CSS. Hiding is what takes it off the stage: a hidden element has no
 * box, so the SDK reports it to the host as no longer composited.
 */
export const AppWindow = ({
  appElements,
  appId,
  clickThrough,
  dragging,
  floating,
  focused,
  onReach,
  onScreen,
}: Props) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [portal, setPortal] = useState<DomicileAppElement | null>(null);

  // The host's frames, resizes, and cursor requests go straight to the element
  // rather than through React state — a frame is a window of pixels arriving
  // many times a second.
  useEffect(() => {
    if (portal === null) {
      return undefined;
    } else {
      appElements.register(appId, portal);
      return () => {
        appElements.unregister(appId);
      };
    }
  }, [appElements, appId, portal]);

  // A click on a client's window asks for the keyboard, and the element grants
  // it unless something answers first. This answers first: the request becomes
  // the shell's to decide, and the effect below is what carries the decision
  // back to the same element a render later.
  useEffect(() => {
    if (portal === null) {
      return undefined;
    } else {
      const answer = (event: Event) => {
        // Unconditionally, and before the branch below: the keyboard stays
        // where the shell put it whether or not this particular click moves
        // anything, which is the difference between a shell that owns focus
        // and one that owns it except where it agrees with the SDK.
        event.preventDefault();
        // The window the user is already in has nothing to report: it would be
        // asking the shell to reach what it has just reached, on every press.
        if (!focused) {
          onReach();
        }
      };
      portal.addEventListener(APP_FOCUS_REQUESTED_EVENT, answer);
      return () => {
        portal.removeEventListener(APP_FOCUS_REQUESTED_EVENT, answer);
      };
    }
  }, [focused, onReach, portal]);

  // The window the user is working in takes the keyboard with it, so they can
  // type into what they just opened, switched to, or brought to the front
  // without clicking it.
  useEffect(() => {
    if (focused && portal !== null) {
      portal.focusApp();
    }
  }, [focused, portal]);

  return (
    <domicile-app
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
      ref={setPortal}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. `undefined` leaves the window
      // filling the stage, which is where a window that is not floating is.
      style={
        floating === undefined
          ? undefined
          : floatPlacement(surfaceBox(floating.float), floating.depth)
      }
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
