import { describe, expect, it } from "bun:test";

import { shellDocument } from "./shell-document";

const document = (over: Partial<Parameters<typeof shellDocument>[0]> = {}) =>
  shellDocument({
    module: "shell.js",
    name: "my-desktop",
    styles: [],
    ...over,
  });

describe("shellDocument", () => {
  it("loads the module as a module", () => {
    expect(document()).toContain('<script src="shell.js" type="module">');
  });

  it("names the shell in the title", () => {
    expect(document({ name: "manganese" })).toContain(
      "<title>manganese</title>",
    );
  });

  it("links stylesheets in the order given", () => {
    const html = document({ styles: ["a.css", "b.css"] });
    expect(html.indexOf('href="a.css"')).toBeLessThan(
      html.indexOf('href="b.css"'),
    );
  });

  // The stylesheet has to be applied before the module runs, or the shell
  // paints unstyled and then styled. `<link>` in the head is render-blocking;
  // a deferred module script is not.
  it("links stylesheets before the module", () => {
    const html = document({ styles: ["a.css"] });
    expect(html.indexOf('href="a.css"')).toBeLessThan(html.indexOf("<script"));
  });

  it("links nothing when there are no stylesheets", () => {
    expect(document()).not.toContain("<link");
  });

  // WHY THESE ARE NOT DECORATION. A desktop is the whole window: a body with
  // the user agent's default margin is eight pixels the compositor believes it
  // has and does not, and a client's window drawn eight pixels out looks like
  // the seam rather than like a stylesheet.
  it.each([
    ["a charset", '<meta charset="utf-8" />'],
    ["a viewport", 'content="width=device-width, initial-scale=1"'],
    ["no body margin", "margin: 0;"],
    ["a full-height root", "block-size: 100%;"],
  ])("always carries %s", (_, expected) => {
    expect(document()).toContain(expected);
  });

  // A manifest is a file this process did not write, and its values reach the
  // most privileged page there is here. A module path that closes the script
  // tag would run whatever followed it in the desktop's own document.
  it("escapes a module path that would close the tag", () => {
    const html = document({
      module: '"></script><script>fetch("/steal")</script>',
    });
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&quot;&gt;&lt;/script&gt;");
  });

  it("escapes a stylesheet path the same way", () => {
    const html = document({ styles: ['"><script>alert(1)</script>'] });
    expect(html).not.toContain("<script>alert");
  });

  it("escapes markup in the name", () => {
    expect(document({ name: "<script>alert(1)</script>" })).not.toContain(
      "<script>alert",
    );
  });

  // Ampersand first, or the escapes would escape each other's output and a
  // path with a legitimate `&` in it would break.
  it("escapes an ampersand once", () => {
    expect(document({ module: "a&b.js" })).toContain('src="a&amp;b.js"');
  });
});
