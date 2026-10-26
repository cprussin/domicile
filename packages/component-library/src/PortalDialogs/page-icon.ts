import { WEBVIEW_WINDOW_ATTRIBUTE } from "@domicile-desktop/sdk/webview-element";

/**
 * Browser window `id`'s page icon URL, as its `<webview window>` in `page`
 * reports it, or `undefined` when no view shows the window or its page has
 * no icon.
 */
export const pageIcon = (page: ParentNode, id: string): string | undefined => {
  const view = [...page.querySelectorAll("webview")].find(
    (element) => element.getAttribute(WEBVIEW_WINDOW_ATTRIBUTE) === id,
  );
  return view === undefined || view.favicon === "" ? undefined : view.favicon;
};
