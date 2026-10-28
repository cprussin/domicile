import {
  WEBVIEW_CONTENT_SIZE_CHANGE_EVENT,
  WEBVIEW_LOADING_CHANGE_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * Whether to show a popup's `<webview>`: once its page has finished loading
 * and sized itself, as Chrome shows its toolbar popup. Until then the page is
 * at a size it is still growing from.
 *
 * Stays true for that view once it is, as Chrome shows its popup once. Reads
 * the element on mount and on each event, as `useContentSize` does. `view` is
 * `null` when missing because it comes from a callback ref.
 */
export const useShown = (view: HTMLWebViewElement | null): boolean => {
  // The view shown, so a new view starts withheld.
  const [shown, setShown] = useState<HTMLWebViewElement | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        if (
          !view.loading &&
          (view.contentWidth !== 0 || view.contentHeight !== 0)
        ) {
          setShown(view);
        }
      };
      read();
      view.addEventListener(WEBVIEW_LOADING_CHANGE_EVENT, read);
      view.addEventListener(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_LOADING_CHANGE_EVENT, read);
        view.removeEventListener(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return view !== null && shown === view;
};
