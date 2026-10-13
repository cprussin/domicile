/**
 * Whether `url` is off the origin of `start`, the address an app window
 * opened at. See docs/architecture/WEB-APPS.md.
 *
 * Compares scheme and host rather than `URL.origin`, which is `"null"` for a
 * scheme the parser does not know, such as `chrome-extension:`. An address
 * that does not parse counts as off the origin, so the user sees it.
 */
export const leftOrigin = (start: string, url: string): boolean => {
  const app = URL.parse(start);
  const page = URL.parse(url);
  return (
    app === null ||
    page === null ||
    app.protocol !== page.protocol ||
    app.host !== page.host
  );
};

/** The host of `url`, or `url` itself when it has none, as `about:blank`. */
export const siteOf = (url: string): string => {
  const host = URL.parse(url)?.host ?? "";
  return host === "" ? url : host;
};
