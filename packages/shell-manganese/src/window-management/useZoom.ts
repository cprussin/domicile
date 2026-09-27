import { WEBVIEW_ZOOM_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * The zoom of the page inside a `<webview>`, as a factor, kept current.
 *
 * **The element is the state and the event is only a nudge**, the same way
 * `useLoading` is: read once as it mounts — a page on a site the user zoomed
 * last week opens zoomed, before this hook has heard anything — and again
 * every time the view says so.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
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
