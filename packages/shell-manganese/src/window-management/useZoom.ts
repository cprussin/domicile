import { WEBVIEW_ZOOM_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * The zoom factor of a `<webview>`'s page.
 *
 * Reads the element on mount and on each change event, like `useLoading`. The
 * mount read matters because a page can open already zoomed. Takes `null`
 * because the element comes from a callback ref.
 */
export const useZoom = (view: HTMLWebViewElement | null): number => {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setZoom(view.zoom);
      };
      read();
      view.addEventListener(WEBVIEW_ZOOM_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_ZOOM_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return zoom;
};
