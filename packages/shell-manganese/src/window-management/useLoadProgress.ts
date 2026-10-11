import { WEBVIEW_LOAD_PROGRESS_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * How far a `<webview>`'s page has loaded, from 0 to 1.
 *
 * Reads `loadProgress` on mount and on each event, like `useLoading`. Takes
 * `null` because the element comes from a callback ref.
 */
export const useLoadProgress = (view: HTMLWebViewElement | null): number => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setProgress(view.loadProgress);
      };
      read();
      view.addEventListener(WEBVIEW_LOAD_PROGRESS_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_LOAD_PROGRESS_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return progress;
};
