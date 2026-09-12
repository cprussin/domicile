import { WEBVIEW_HISTORY_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useState } from "react";

/** Where a view's history reaches, which is what its controls are for. */
type HistoryAvailability = {
  canGoBack: boolean;
  canGoForward: boolean;
};

/**
 * A history that reaches neither way, which is what a window with no view in
 * it yet can do.
 */
const NOWHERE: HistoryAvailability = { canGoBack: false, canGoForward: false };

/**
 * Where the page inside a `<webview>` can be sent, kept current.
 *
 * **The element is the state and the event is only a nudge.** The engine
 * pushes nothing with `domicile-history-change`; what changed is readable on
 * the element, and this reads it — once as it mounts and again every time the
 * view says so. Reading on mount is the half that cannot be dropped: a React
 * shell registers its listeners in its first effect flush, and an event
 * dispatched before that is gone, so a window that only ever listened would
 * grey out a live control until the user navigated again.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
 */
export const useHistoryAvailability = (
  view: HTMLWebViewElement | null,
): HistoryAvailability => {
  const [availability, setAvailability] = useState(NOWHERE);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setAvailability({
          canGoBack: view.canGoBack,
          canGoForward: view.canGoForward,
        });
      };
      read();
      view.addEventListener(WEBVIEW_HISTORY_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_HISTORY_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return availability;
};
