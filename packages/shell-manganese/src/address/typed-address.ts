// What a line of typed text means as a web address.
//
// Two answers, ranked: a site, then a search. The order is the whole of the
// design — every query is a search if nothing better claims it first, so the
// claim above it has to be one that can be made confidently. A site is a
// scheme somebody wrote down, or a host under a TLD that exists; what is left
// is words, and words are a search.
//
// Both the launcher's box and a browser window's address bar ask this
// question, and they have to answer it the same way: a desktop where `mod+space`
// and the address bar disagree about what `localhost:5173` means is one where
// the user has to remember which box they are in.

import { searchUrl } from "./search";

/** Which of the two things a typed line can turn out to be. */
export enum TypedAddressKind {
  Site,
  Search,
}

export const TypedAddress = {
  /**
   * Words, and where they go. `query` is what was typed — the address bar
   * offers it back as "Search for …", so it is worth keeping beside the URL
   * it made rather than escaping it twice.
   */
  Search: (query: string, url: string) => ({
    kind: TypedAddressKind.Search as const,
    query,
    url,
  }),
  /** A site: a scheme somebody wrote down, or a host under a TLD that exists. */
  Site: (url: string) => ({ kind: TypedAddressKind.Site as const, url }),
};

export type TypedAddress = ReturnType<
  (typeof TypedAddress)[keyof typeof TypedAddress]
>;

/**
 * What `typed` means, or `undefined` for a line with nothing in it.
 *
 * Nothing rather than a guess for the empty line: Enter on an empty box is a
 * keystroke nobody meant as a command, and a search for the empty string is
 * worse than not answering.
 */
export const typedAddress = (typed: string): TypedAddress | undefined => {
  const query = typed.trim();
  if (query === "") {
    return undefined;
  } else if (hasScheme(query)) {
    return TypedAddress.Site(query);
  } else if (isHost(query)) {
    // https rather than http: a desktop should not make the insecure guess on
    // a user's behalf, and a site that only speaks http will say so.
    return TypedAddress.Site(`https://${query}`);
  } else {
    return TypedAddress.Search(query, searchUrl(query));
  }
};

/**
 * The schemes that address a thing without an authority after the colon.
 *
 * A named set rather than "any scheme", because the `//` is what tells a
 * scheme from a word with a colon after it everywhere else: `note:to self` is
 * a search, and `ratio 16:9` is a search, and neither should become a
 * navigation because it is spelled like one. These are the ones a person types
 * on purpose — `domicile:` among them, because this desktop's own shell is
 * served over it.
 */
const BARE_SCHEMES: readonly string[] = [
  "about",
  "data",
  "domicile",
  "mailto",
  "view-source",
];

/** Whether somebody wrote a scheme down, in which case there is nothing to guess. */
const hasScheme = (typed: string): boolean =>
  /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ||
  BARE_SCHEMES.some((scheme) => typed.toLowerCase().startsWith(`${scheme}:`));

/**
 * The endings that make a word a hostname rather than the end of a sentence.
 *
 * This desktop's own list rather than the public suffix list. A desktop that
 * recognised every TLD would read "the sentence ends. Then another" as a
 * request for a site in `.then`, and there is no shortage of registries whose
 * TLD is an ordinary English word. These are the ones this desktop's user
 * actually types, which is the same argument the shell script makes by
 * carrying a list of nine.
 */
const TLDS: readonly string[] = [
  "co",
  "com",
  "dev",
  "do",
  "edu",
  "gov",
  "io",
  "me",
  "net",
  "org",
  "sh",
  "xyz",
];

/**
 * Whether `typed` is a host, with or without a port and a path after it.
 *
 * `localhost` by name, because it is the one hostname with no dot in it that a
 * person types on purpose — and on a machine that is also a development box,
 * types constantly.
 */
const isHost = (typed: string): boolean => {
  const host = typed.split(/[/:?#]/)[0] ?? "";
  const tld = host.split(".").at(-1) ?? "";
  return (
    host === "localhost" ||
    (host.includes(".") && TLDS.includes(tld.toLowerCase()))
  );
};
