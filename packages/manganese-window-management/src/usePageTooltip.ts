import { WEBVIEW_TOOLTIP_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** A `<webview>`'s tooltip and where the pointer was when it appeared. */
export type PageTooltip = {
  text: string;
  /** In the element's CSS pixels from its top left. */
  x: number;
  y: number;
};

const NONE: PageTooltip = { text: "", x: 0, y: 0 };

/**
 * The tooltip under the pointer in a `<webview>`'s page, with `text` `""` for
 * none.
 *
 * Reads the element on mount and on each change event, like `useTargetUrl`.
 * Takes `null` because the element comes from a callback ref.
 */
export const usePageTooltip = (
  view: HTMLWebViewElement | null,
): PageTooltip => {
  const [tooltip, setTooltip] = useState(NONE);

  useEffect(() => {
    if (view === null) {
      setTooltip(NONE);
      return undefined;
    } else {
      const read = () => {
        // An engine without tooltips, or a test's element, has none.
        setTooltip({
          text: view.tooltip ?? "",
          x: view.tooltipX ?? 0,
          y: view.tooltipY ?? 0,
        });
      };
      read();
      view.addEventListener(WEBVIEW_TOOLTIP_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_TOOLTIP_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  return tooltip;
};
