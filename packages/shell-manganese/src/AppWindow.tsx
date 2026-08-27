import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import { useEffect, useState } from "react";

import { css, cx } from "../styled-system/css";
import type { AppElements } from "./app-elements";
import type { Floating } from "./shell-state";
import {
  clickThroughStyles,
  draggingStyles,
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
      )}
      hidden={!onScreen}
      ref={setPortal}
      // Inline because the box is a runtime number and Panda reads literals;
      // `window-styles` owns everything static. `undefined` leaves the window
      // filling the stage, which is where a window that is not floating is.
      style={
        floating === undefined
          ? undefined
          : floatPlacement(floating.float, floating.depth)
      }
    />
  );
};

const appStyles = css({
  // Placeholder label until the real surface is composited in, hidden the
  // moment the element has pixels of its own to show.
  "&:not(.has-surface)::after": {
    color: "muted",
    content: '"⬚  app surface: " attr(app-id)',
    display: "grid",
    fontSize: "sm",
    inset: 0,
    placeItems: "center",
    position: "absolute",
    textAlign: "center",
  },
  // Rounded by the compositor, not by the browser: this element is a hole in
  // the page and has no pixels of its own to clip. The SDK reports the radius
  // with the placement and the compositor's shader applies it to the client's
  // own buffer, which is why a window can be round at all without a copy. A
  // length rather than a percentage on purpose — a `%` radius is one the shader
  // cannot draw, and it would send every window down the copy path.
  borderRadius: "lg",
});
