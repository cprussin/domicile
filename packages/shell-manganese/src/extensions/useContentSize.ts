import { WEBVIEW_CONTENT_SIZE_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { useEffect, useState } from "react";

/** The size a page's content wants, in CSS pixels. */
export type ContentSize = { height: number; width: number };

/**
 * The size the page inside a `<webview>` wants, kept current, or `undefined`
 * until the page has laid out — the engine reports 0 by 0 until then.
 *
 * **The element is the state and the event is only a nudge**, as in
 * `useFindResult`: read once as it mounts and again every time the view says
 * so.
 *
 * `null` rather than `undefined` for the missing view because that is what
 * React's ref API hands a callback ref, which is where the element comes from.
 */
export const useContentSize = (
  view: HTMLWebViewElement | null,
): ContentSize | undefined => {
  const [size, setSize] = useState<ContentSize | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        setSize(
          view.contentWidth === 0 && view.contentHeight === 0
            ? undefined
            : { height: view.contentHeight, width: view.contentWidth },
        );
      };
      read();
      view.addEventListener(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_CONTENT_SIZE_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return size;
};
