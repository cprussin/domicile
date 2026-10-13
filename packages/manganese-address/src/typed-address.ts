// Interprets a typed line as a site or a search.
//
// A line is a site only when that is certain: an explicit scheme, or a host
// under a real TLD. Everything else is a search.
//
// The launcher and the browser address bar share this so they agree on what
// input like `localhost:5173` means.

import { searchUrl } from "./search";
import { TLDS } from "./tlds";

/** What a typed line turns out to be. */
export enum TypedAddressKind {
  Site,
  Search,
}

export const TypedAddress = {
  /**
   * Words and their search URL. `query` is kept so the address bar can show
   * "Search for …" without unescaping the URL.
   */
  Search: (query: string, url: string) => ({
    kind: TypedAddressKind.Search as const,
    query,
    url,
  }),
  /** An explicit scheme, or a host under a real TLD. */
  Site: (url: string) => ({ kind: TypedAddressKind.Site as const, url }),
};

export type TypedAddress = ReturnType<
  (typeof TypedAddress)[keyof typeof TypedAddress]
>;

/**
 * What `typed` means, or `undefined` for an empty line.
 *
 * Enter on an empty box does nothing rather than search for nothing.
 */
export const typedAddress = (typed: string): TypedAddress | undefined => {
  const query = typed.trim();
  if (query === "") {
    return undefined;
  } else if (hasScheme(query)) {
    return TypedAddress.Site(query);
  } else if (isHost(query)) {
    // https, not http: do not make the insecure guess for the user.
    return TypedAddress.Site(`https://${query}`);
  } else {
    return TypedAddress.Search(query, searchUrl(query));
  }
};

/**
 * Schemes typed without `//`, such as `about:blank`.
 *
 * A fixed list, because without `//` a colon usually just means words:
 * `note:to self` and `ratio 16:9` are searches. `domicile:` serves this
 * desktop's own shell.
 */
const BARE_SCHEMES: readonly string[] = [
  "about",
  "data",
  "domicile",
  "mailto",
  "view-source",
];

/** Whether `typed` starts with an explicit scheme. */
const hasScheme = (typed: string): boolean =>
  /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ||
  BARE_SCHEMES.some((scheme) => typed.toLowerCase().startsWith(`${scheme}:`));

/**
 * Whether `typed` is a host, optionally with a port and path.
 *
 * `localhost` is special-cased as the one dotless hostname people type.
 */
const isHost = (typed: string): boolean => {
  const host = typed.split(/[/:?#]/)[0] ?? "";
  const tld = host.split(".").at(-1) ?? "";
  return (
    host === "localhost" || (host.includes(".") && TLDS.has(tld.toLowerCase()))
  );
};
