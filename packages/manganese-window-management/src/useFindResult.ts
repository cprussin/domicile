import { WEBVIEW_FIND_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * A find-in-page result: the match count and the 1-based active match. Both are
 * 0 when there is no find.
 */
export type FindResult = { activeMatch: number; matches: number };

/** The result before any find. */
const NOTHING_FOUND: FindResult = { activeMatch: 0, matches: 0 };

/**
 * The current find-in-page result of a `<webview>`.
 *
 * Reads the element's properties on mount and on each change event, like
 * `useZoom`. Takes `null` because the element comes from a callback ref.
 */
export const useFindResult = (view: HTMLWebViewElement | null): FindResult => {
  const [result, setResult] = useState(NOTHING_FOUND);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setResult({
          activeMatch: view.findActiveMatch,
          matches: view.findMatches,
        });
      };
      read();
      view.addEventListener(WEBVIEW_FIND_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_FIND_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return result;
};
