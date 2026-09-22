import { describe, expect, it } from "bun:test";
import { Hint, hintFor } from "./hint";

const FILES = ["Notes/today.org", "todo.txt"];

describe("hintFor", () => {
  it("has nothing to say about an empty box", () => {
    expect(hintFor("   ", FILES)).toBeUndefined();
  });

  it("offers the file a typed path names", () => {
    expect(hintFor("todo.txt", FILES)).toStrictEqual(Hint.Edit("todo.txt"));
  });

  it("offers the site a typed address names", () => {
    expect(hintFor("example.com", FILES)).toStrictEqual(
      Hint.Site("https://example.com"),
    );
  });

  it("offers the words back rather than the URL they would become", () => {
    // What the address bar does for the same line, and for the same reason:
    // answering "kate bush" with `google.com/search?q=kate%20bush` tells the
    // user their query has turned into a URL they now have to read.
    expect(hintFor("kate bush", FILES)).toStrictEqual(Hint.Search("kate bush"));
  });
});
