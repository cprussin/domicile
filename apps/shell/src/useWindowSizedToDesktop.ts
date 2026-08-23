import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { useEffect } from "react";

import { desktopSize } from "./desktop-size";

/**
 * Keeps the window the chrome is drawn in as big as the desktop it is drawing.
 *
 * The page *is* the desktop: a `<Screen>` is a region of it at the display's
 * own coordinates, and the SDK places every portal from a
 * `getBoundingClientRect`. A window smaller than the desktop leaves the
 * right-hand screens off the end of the viewport, where they still lay out and
 * still report positions the compositor will honour — an invisible chrome
 * placing visible clients.
 *
 * Cross-process, which is why it goes through the host rather than
 * `window.resizeTo`: the desktop arrives on this renderer's bridge and the
 * window belongs to the main process. There is no host at all when the shell
 * is opened in a plain browser for styling work, so the ask is skipped rather
 * than the absence being an error.
 *
 * Where Domicile composites the chrome itself the ask is made and *not
 * answered*: the compositor hands that window the whole desktop whatever it
 * asks for, so there is nothing for the host to do, and `main.ts` — which is
 * the half that knows how this window is being presented — does not wire the
 * channel up. The page cannot know which of the two it is in, and does not
 * need to.
 *
 * Skipped for a desktop of no screens, which is neither of those: `0 × 0` is
 * not a window, and it is what the bounding box of nothing comes to. The
 * chrome renders nothing at all for that same desktop, since `<Screen>` has no
 * display to place against — so a window resized to nothing would be the one
 * part of the shell acting on it.
 */
export const useWindowSizedToDesktop = (): void => {
  const displays = useDisplays();
  useEffect(() => {
    const host = window.domicileWindow;
    if (displays !== undefined && displays.length > 0 && host !== undefined) {
      const [width, height] = desktopSize(displays);
      host.sizeToDesktop(width, height);
    }
  }, [displays]);
};
