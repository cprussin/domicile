import { WEBVIEW_TARGET_URL_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * The address of the link under the pointer in a `<webview>`'s page, or `""`.
 *
 * Reads the element on mount and on each change event, like `useZoom`. Takes
 * `null` because the element comes from a callback ref.
 */
export const useTargetUrl = (view: HTMLWebViewElement | null): string => {
  const [targetUrl, setTargetUrl] = useState("");

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setTargetUrl(view.targetUrl);
      };
      read();
      view.addEventListener(WEBVIEW_TARGET_URL_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_TARGET_URL_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return targetUrl;
};
