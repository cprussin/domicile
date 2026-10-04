import { WEBVIEW_CONTENT_SIZE_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** A page's content size, in CSS pixels. */
export type ContentSize = { height: number; width: number };

/**
 * The content size of the page in a `<webview>`, or `undefined` until it has
 * laid out (the engine reports 0x0 until then).
 *
 * Reads the size from the element on mount and on each resize event, as
 * `useFindResult` does. `view` is `null` when missing because it comes from a
 * callback ref.
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
