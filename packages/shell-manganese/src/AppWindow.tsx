import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import { useEffect, useState } from "react";

import { css, cx } from "../styled-system/css";
import type { AppElements } from "./app-elements";
import { windowStyles } from "./window-styles";

type Props = {
  /** Whether this window has the stage. */
  active: boolean;
  appElements: AppElements;
  /** The host's name for the client this portal shows. */
  appId: string;
};

/**
 * A Wayland client's window: one `<domicile-app>` portal, which is the whole
 * point of Domicile — the client's live pixels are a real element that takes
 * ordinary CSS. Hiding is what takes it off the stage: a hidden element has no
 * box, so the SDK reports it to the host as no longer composited.
 */
export const AppWindow = ({ active, appElements, appId }: Props) => {
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

  // The window that lands on the stage takes the keyboard with it, so the user
  // can type into what they just opened or switched to without clicking it.
  useEffect(() => {
    if (active && portal !== null) {
      portal.focusApp();
    }
  }, [active, portal]);

  return (
    <domicile-app
      app-id={appId}
      className={cx(windowStyles, appStyles)}
      hidden={!active}
      ref={setPortal}
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
