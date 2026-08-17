/** What an address typed without one gets. */
const DEFAULT_SCHEME = "https://";

/**
 * `example.com` is an address, not a relative path — a browser's address bar
 * says so by loading it over https.
 */
export const withScheme = (address: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(address)
    ? address
    : `${DEFAULT_SCHEME}${address}`;
