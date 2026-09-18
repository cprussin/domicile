import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * Whether the page inside a `<webview>` is still arriving, kept current.
 *
 * **The element is the state and the event is only a nudge**, the same way
 * `useHistoryAvailability` is: the engine pushes nothing with
 * `domicile-loading-change`, and what changed is readable on the element. This
 * reads it once as it mounts and again every time the view says so. The mount
 * read is the half that cannot be dropped — a React shell registers its
 * listeners in its first effect flush, so a window whose guest began loading
 * before then would sit looking settled over a page that had not arrived.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
 */
export const useLoading = (view: HTMLWebViewElement | null): boolean => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setLoading(view.loading);
      };
      read();
      view.addEventListener(WEBVIEW_LOADING_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_LOADING_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return loading;
};
