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
  // The live client's pixels fill the element.
  "& .domicile-app-surface": {
    blockSize: "100%",
    borderStyle: "none",
    display: "block",
    imageRendering: "auto",
    inlineSize: "100%",
  },
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
  // own buffer, which is why a window can be round at all without a copy.
  borderRadius: "lg",

  // Loud on purpose. A realistic shadow is dark, the stage is dark, and the
  // two are indistinguishable by eye — which tells you nothing about whether
  // the compositor drew one. `accent` at full strength with no offset reads as
  // a halo: unmistakably present, or unmistakably absent.
  //
  // A token, not a literal, so this also exercises the colour path: the preset
  // writes every colour through `color-mix(in oklab, ...)`, which computes to
  // `oklab(...)` — a syntax the SDK could not read until #46.
  boxShadow: "0 0 24px 6px {colors.accent}",

  // --- everything below this line is the demonstration, and is why this
  // --- branch is not meant to be merged. See the PR description.

  // A shadow needs somewhere to fall, and a window that fills the stage has
  // nowhere. `margin` rather than `inset`, because `windowStyles` already sets
  // `inset: 0` and two atomic classes on one element tie on specificity — an
  // `inset` here would win or lose depending on how the bundle happened to
  // order them.
  margin: "8",

  // Every one of these is drawn by the compositor's own shader against the
  // client's dmabuf. None of them is the engine painting a picture of a
  // window: the element is a hole, and what shows through it is the client.
  //
  // Slightly transparent, which is what makes the shadow's cut-out visible:
  // the shadow is not painted under the window it falls from, and before that
  // was fixed it bled through any window you could see through.
  opacity: 0.9,
  // The independent `rotate` property rather than `transform`, because that is
  // the spelling most people reach for — and because it did nothing until #49.
  // Either works now.
  rotate: "-3deg",
});
