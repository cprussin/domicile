// Where a query that is not a file and not a URL goes.
//
// The bang tags of the launcher this desktop is modeled on: a query carries
// `!yt` or `!wiki` somewhere in it and that word picks the engine, and a query
// that carries none goes to Google. Anywhere in the query rather than at the
// front, because that is how a tag actually gets typed — the words go in, the
// wrong results are imagined, and the tag is appended.

/** How a query becomes a URL, with `%QUERY%` standing in for the escaped text. */
const GOOGLE = "https://google.com/search?q=%QUERY%";

/**
 * The tags, and what each one searches.
 *
 * A plain table rather than a `Map`, so adding an engine is one line and the
 * tag is spelled once. The keys carry their `!` because that is what the user
 * types and because a bare `yt` is a word somebody may be searching for.
 */
const ENGINES: Readonly<Record<string, string>> = {
  "!im": "https://www.google.com/search?q=%QUERY%&tbm=isch",
  "!maps": "https://www.google.com/maps/search/%QUERY%",
  "!wiki": "https://en.wikipedia.org/wiki/Special:Search?search=%QUERY%",
  "!yt": "https://www.youtube.com/results?search_query=%QUERY%",
};

/** Where to send `query`: the engine its tag names, or Google. */
export const searchUrl = (query: string): string => {
  const tag = tagIn(query);
  const searched = tag === undefined ? query : withoutTag(query, tag);
  const engine = tag === undefined ? GOOGLE : ENGINES[tag];
  if (engine === undefined) {
    throw new Error(`launcher: no engine for the tag ${tag}`);
  } else {
    return engine.replace("%QUERY%", encodeURIComponent(searched.trim()));
  }
};

/**
 * The tag `query` carries, or `undefined` for one that carries none.
 *
 * A whole word, so `hello!yt world` is three words of a search rather than a
 * change of engine that also eats three letters. The first one wins: two tags
 * is not a thing to have a policy about, and picking one is better than
 * running a query with both taken out.
 */
const tagIn = (query: string): string | undefined =>
  words(query).find((word) => word in ENGINES);

/** `query` with the tag taken out, and the gap it left closed up. */
const withoutTag = (query: string, tag: string): string =>
  words(query)
    .filter((word) => word !== tag)
    .join(" ");

const words = (query: string): readonly string[] =>
  query.split(/\s+/).filter((word) => word !== "");
