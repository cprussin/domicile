import { WEBVIEW_HISTORY_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** Whether a view can go back or forward, for its history controls. */
type HistoryAvailability = {
  canGoBack: boolean;
  canGoForward: boolean;
};

/** No history in either direction, as for a window with no view yet. */
const NOWHERE: HistoryAvailability = { canGoBack: false, canGoForward: false };

/**
 * The current back/forward availability of a `<webview>`.
 *
 * `domicile-history-change` carries no data, so this reads the element's
 * properties on mount and on each event. The mount read is required: an event
 * fired before the first effect runs is missed. Takes `null` because the
 * element comes from a callback ref.
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
