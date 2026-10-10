import { WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Keeps a `<webview>`'s page fullscreen in step with its window.
 *
 * - Reports the page's fullscreen to `onFullscreen` as it mounts, then on each
 *   change, as `usePageIcon` does.
 * - Takes the page out of fullscreen when `fullscreen`, whether the window
 *   fills its screen, turns false, as a browser does when its window leaves
 *   fullscreen. Only on that turn: a page that just entered fullscreen is in a
 *   window that has not followed it yet.
 *
 * Takes `null` because the element comes from a callback ref.
 */
export const usePageFullscreen = (
  view: HTMLWebViewElement | null,
  fullscreen: boolean,
  onFullscreen: (fullscreen: boolean) => void,
): void => {
  // An effect event, so a new `onFullscreen` each render does not report
  // again.
  const report = useEffectEvent((pageFullscreen: boolean) => {
    onFullscreen(pageFullscreen);
  });

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        report(view.pageFullscreen);
      };
      read();
      view.addEventListener(WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_PAGE_FULLSCREEN_CHANGE_EVENT, read);
      };
    }
  }, [view]);

  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (wasFullscreen.current && !fullscreen && view?.pageFullscreen === true) {
      view.exitPageFullscreen();
    }
    wasFullscreen.current = fullscreen;
  }, [fullscreen, view]);
};
