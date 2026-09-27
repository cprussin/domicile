// Where a query that is not a file and not a URL goes.
//
// The bang tags of the launcher this desktop is modeled on: a query carries
// `!yt` or `!wiki` somewhere in it and that word picks the engine, and a query
// that carries none goes to Google. Anywhere in the query rather than at the
// front, because that is how a tag actually gets typed — the words go in, the
// wrong results are imagined, and the tag is appended.

/** How a query becomes a URL, with `%QUERY%` standing in for the escaped text. */
const GOOGLE = "https://google.com/search?q=%QUERY%";

/** The sites a tag can send a query to. */
export enum Engine {
  GoogleImages,
  GoogleMaps,
  Wikipedia,
  YouTube,
}

/** A query a tag sent somewhere other than Google. */
export type TaggedSearch = {
  engine: Engine;
  /** The words, with the tag taken out. */
  query: string;
  url: string;
};

/**
 * The tags, and the engine each one picks.
 *
 * A plain table rather than a `Map`, so the tag is spelled once. The keys carry their `!` because that is what the user
 * types and because a bare `yt` is a word somebody may be searching for.
 */
const TAGS: Readonly<Record<string, Engine>> = {
  "!im": Engine.GoogleImages,
  "!maps": Engine.GoogleMaps,
  "!wiki": Engine.Wikipedia,
  "!yt": Engine.YouTube,
};

/** How a query becomes a URL on each engine. */
const ENGINE_URLS: Readonly<Record<Engine, string>> = {
  [Engine.GoogleImages]: "https://www.google.com/search?q=%QUERY%&tbm=isch",
  [Engine.GoogleMaps]: "https://www.google.com/maps/search/%QUERY%",
  [Engine.Wikipedia]:
    "https://en.wikipedia.org/wiki/Special:Search?search=%QUERY%",
  [Engine.YouTube]: "https://www.youtube.com/results?search_query=%QUERY%",
};

/** Where to send `query`: the engine its tag names, or Google. */
export const searchUrl = (query: string): string =>
  taggedSearch(query)?.url ?? googleUrl(query);

/** `query` searched on Google as it is, tag and all. */
export const googleUrl = (query: string): string => urlOf(GOOGLE, query);

/** The search `query`'s tag names, or `undefined` for one that carries none. */
export const taggedSearch = (query: string): TaggedSearch | undefined => {
  const tag = tagIn(query);
  if (tag === undefined) {
    return undefined;
  } else {
    const engine = engineOf(tag);
    const searched = withoutTag(query, tag);
    return {
      engine,
      query: searched,
      url: urlOf(ENGINE_URLS[engine], searched),
    };
  }
};

const engineOf = (tag: string): Engine => {
  const engine = TAGS[tag];
  if (engine === undefined) {
    throw new Error(`launcher: no engine for the tag ${tag}`);
  } else {
    return engine;
  }
};

const urlOf = (template: string, query: string): string =>
  template.replace("%QUERY%", encodeURIComponent(query.trim()));

/**
 * The tag `query` carries, or `undefined` for one that carries none.
 *
 * A whole word, so `hello!yt world` is three words of a search rather than a
 * change of engine that also eats three letters. The first one wins: two tags
 * is not a thing to have a policy about, and picking one is better than
 * running a query with both taken out.
 */
const tagIn = (query: string): string | undefined =>
  words(query).find((word) => word in TAGS);

/** `query` with the tag taken out, and the gap it left closed up. */
const withoutTag = (query: string, tag: string): string =>
  words(query)
    .filter((word) => word !== tag)
    .join(" ");

const words = (query: string): readonly string[] =>
  query.split(/\s+/).filter((word) => word !== "");
