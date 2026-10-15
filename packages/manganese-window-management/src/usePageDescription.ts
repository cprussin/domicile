import { WEBVIEW_DESCRIPTION_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useEffectEvent } from "react";

/**
 * Reports a `<webview>`'s page description, `""` for none, to `onDescription`
 * with the view's `window`: as it mounts, then on each change.
 *
 * Reads on mount for the same reason as `usePageIcon`. Takes `null` because
 * the element comes from a callback ref.
 */
export const usePageDescription = (
  view: HTMLWebViewElement | null,
  window: string,
  onDescription: (window: string, description: string) => void,
): void => {
  // An effect event, so a new `onDescription` each render does not report
  // again.
  const report = useEffectEvent((description: string) => {
    onDescription(window, description);
  });

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const read = () => {
        report(view.description);
      };
      read();
      view.addEventListener(WEBVIEW_DESCRIPTION_CHANGE_EVENT, read);
      return () => {
        view.removeEventListener(WEBVIEW_DESCRIPTION_CHANGE_EVENT, read);
      };
    }
  }, [view]);
};
