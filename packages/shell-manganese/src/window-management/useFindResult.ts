import { WEBVIEW_FIND_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/**
 * What a find in the page has found: how many matches, and which of them is
 * selected, counted from 1. Both 0 while there is no find.
 */
export type FindResult = { activeMatch: number; matches: number };

/** No find, which is where a page starts. */
const NOTHING_FOUND: FindResult = { activeMatch: 0, matches: 0 };

/**
 * What a find in the page inside a `<webview>` has found, kept current.
 *
 * **The element is the state and the event is only a nudge**, the same way
 * `useZoom` is: read once as it mounts and again every time the view says so.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
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
