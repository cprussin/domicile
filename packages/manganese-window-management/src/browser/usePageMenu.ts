import { WEBVIEW_CONTEXT_MENU_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useCallback, useEffect, useState } from "react";

import type { PageContext } from "./page-menu";
import { pageContextOf } from "./page-menu";

/** A context menu the page in a view asked for, and where to draw it. */
export type AskedMenu = {
  /** Where the click was, in the viewport's CSS pixels. */
  at: { x: number; y: number };
  context: PageContext;
};

/**
 * The newest context menu the page in `view` asked for, or `undefined`, and a
 * function to dismiss it.
 *
 * The viewport position is computed on arrival from the view's current box.
 * `view` is `null` because React's ref API passes `null`.
 */
export const usePageMenu = (
  view: HTMLElement | null,
): [AskedMenu | undefined, () => void] => {
  const [asked, setAsked] = useState<AskedMenu | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const took = (event: DomicileContextMenuEvent) => {
        const context = pageContextOf(event);
        const box = view.getBoundingClientRect();
        setAsked({
          at: { x: box.left + context.x, y: box.top + context.y },
          context,
        });
      };
      view.addEventListener(WEBVIEW_CONTEXT_MENU_EVENT, took);
      return () => {
        view.removeEventListener(WEBVIEW_CONTEXT_MENU_EVENT, took);
      };
    }
  }, [view]);

  const dismiss = useCallback(() => {
    setAsked(undefined);
  }, []);

  return [asked, dismiss];
};
