import { describe, expect, it } from "bun:test";

import { Engine, searchUrl, taggedSearch, taggedSite } from "./search";

describe("searchUrl", () => {
  it("searches Google for a query with no tag in it", () => {
    expect(searchUrl("wayland xdg shell")).toBe(
      "https://google.com/search?q=wayland%20xdg%20shell",
    );
  });

  it("sends a !maps query to Google Maps", () => {
    expect(searchUrl("!maps ferry building")).toBe(
      "https://www.google.com/maps/search/ferry%20building",
    );
  });

  it("sends a !wiki query to Wikipedia", () => {
    expect(searchUrl("!wiki compositing window manager")).toBe(
      "https://en.wikipedia.org/wiki/Special:Search?search=compositing%20window%20manager",
    );
  });

  it("sends a !yt query to YouTube", () => {
    expect(searchUrl("!yt kate bush")).toBe(
      "https://www.youtube.com/results?search_query=kate%20bush",
    );
  });

  it("sends an !im query to Google Images", () => {
    expect(searchUrl("!im brutalism")).toBe(
      "https://www.google.com/search?q=brutalism&tbm=isch",
    );
  });

  it("sends a !gh query of one word to that user or repository on GitHub", () => {
    // A name is a place on GitHub before it is a search, so the one word goes
    // to the page it names; the search is the launcher's second row.
    expect(searchUrl("!gh cprussin")).toBe("https://github.com/cprussin");
    expect(searchUrl("!gh cprussin/domicile")).toBe(
      "https://github.com/cprussin/domicile",
    );
  });

  it("searches GitHub for a !gh query that is not one name", () => {
    expect(searchUrl("!gh wayland compositor")).toBe(
      "https://github.com/search?q=wayland%20compositor",
    );
  });

  it("takes the tag from anywhere in the query, not only the front", () => {
    // Typed as a correction, which is how a tag usually gets written: the
    // query goes in, the wrong results are imagined, and the tag is appended.
    expect(searchUrl("kate bush !yt")).toBe(
      "https://www.youtube.com/results?search_query=kate%20bush",
    );
  });

  it("reads a tag only as a word of its own", () => {
    // `!yt` inside a word is part of what is being searched for. Without this
    // the launcher would quietly change engines on a query nobody tagged, and
    // the query it ran would be missing the letters it took out.
    expect(searchUrl("hello!yt world")).toBe(
      "https://google.com/search?q=hello!yt%20world",
    );
  });

  it("escapes what the query puts in the URL", () => {
    // A query is user text going into a URL, and `&` is the one character
    // that turns the rest of it into somebody else's parameter.
    expect(searchUrl("tabs & spaces")).toBe(
      "https://google.com/search?q=tabs%20%26%20spaces",
    );
  });

  it("searches for nothing rather than for the tag when a tag is all there is", () => {
    // `!yt` alone is a person on the way to typing something. Searching for
    // the literal "!yt" would be the launcher answering a question that was
    // not finished.
    expect(searchUrl("!yt")).toBe(
      "https://www.youtube.com/results?search_query=",
    );
  });
});

describe("taggedSearch", () => {
  it("names the engine a tag picks, and the words without the tag", () => {
    expect(taggedSearch("kate bush !yt")).toStrictEqual({
      engine: Engine.YouTube,
      query: "kate bush",
      url: "https://www.youtube.com/results?search_query=kate%20bush",
    });
  });

  it("is nothing for a query with no tag in it", () => {
    expect(taggedSearch("kate bush")).toBeUndefined();
  });
});

describe("taggedSite", () => {
  it("names the page a !gh query's one word goes to", () => {
    expect(taggedSite("cprussin/domicile !gh")).toStrictEqual({
      engine: Engine.GitHub,
      path: "cprussin/domicile",
      url: "https://github.com/cprussin/domicile",
    });
  });

  it("is nothing for words that are not a name on the tag's site", () => {
    // More than a user and a repository is a path GitHub has no page for, and
    // a site the tag names has no pages to go to at all.
    expect(taggedSite("!gh kate bush")).toBeUndefined();
    expect(taggedSite("!gh a/b/c")).toBeUndefined();
    expect(taggedSite("!wiki mesa")).toBeUndefined();
  });
});
