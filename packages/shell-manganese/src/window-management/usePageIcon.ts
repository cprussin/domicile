import { WEBVIEW_FAVICON_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useEffectEvent } from "react";

/**
 * Reports a `<webview>`'s page icon URL, `""` for none, to `onIcon` with the
 * view's `window`: as it mounts, then on each change.
 *
 * The mount read gives a page the view picked up after a reload its icon,
 * which no event would announce. Takes `null` because the element comes from
 * a callback ref.
 */
export const usePageIcon = (
  view: HTMLWebViewElement | null,
  window: string,
  onIcon: (window: string, icon: string) => void,
): void => {
  // An effect event, so a new `onIcon` each render does not report again.
  const report = useEffectEvent((icon: string) => {
    onIcon(window, icon);
  });

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        report(view.favicon);
      };
      read();
      view.addEventListener(WEBVIEW_FAVICON_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_FAVICON_CHANGE_EVENT, read);
      };
    }
  }, [view]);
};
