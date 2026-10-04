import { WEBVIEW_LOADING_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * Whether a `<webview>`'s page is loading.
 *
 * `domicile-loading-change` carries no data, so this reads `loading` on mount
 * and on each event. The mount read is required: an event fired before the
 * first effect runs is missed. Takes `null` because the element comes from a
 * callback ref.
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
