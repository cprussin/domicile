/**
 * The `<app>` in `page` showing a request's parent window, for its dialog to
 * spring from. `undefined` when the request has none or the page does not
 * draw it.
 */
export const askingWindow = (
  page: ParentNode,
  parentAppId: string | undefined,
): Element | undefined =>
  parentAppId === undefined
    ? undefined
    : [...page.querySelectorAll("app[app-id]")].find(
        (app) => app.getAttribute("app-id") === parentAppId,
      );
