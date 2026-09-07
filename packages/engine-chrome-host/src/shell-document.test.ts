import { describe, expect, it } from "bun:test";

import { shellDocument } from "./shell-document";

const document = (module = "shell.js") => shellDocument(module);

describe("shellDocument", () => {
  it("loads the module as a module", () => {
    expect(document()).toContain('<script src="shell.js" type="module">');
  });

  // Not the directory the module came out of, which is as likely to be `dist`
  // as anything a person would recognise. A shell that wants another sets
  // `document.title`, like any other page.
  it("does not guess a title", () => {
    expect(document()).toContain("<title>Domicile</title>");
  });

  // THE OMISSION THAT MATTERS. A shell's CSS arrives through its module, so
  // nothing paints before the module has run — which is what makes a theme a
  // shell remembers settable from its first line. A render-blocking <link>
  // would paint first and force the shell into a blocking <head> script.
  it("links no stylesheet", () => {
    expect(document()).not.toContain("<link");
  });

  // A desktop is the whole window: a body with the user agent's default margin
  // is eight pixels the compositor believes it has and does not, and a client's
  // window drawn eight pixels out looks like the seam.
  it.each([
    ["a charset", '<meta charset="utf-8" />'],
    ["a viewport", 'content="width=device-width, initial-scale=1"'],
    ["no body margin", "margin: 0;"],
    // The *body* is the full-height root — `docs/WRITING-A-SHELL.md` promises
    // "a root that fills the window with no margin" and this is it. Named
    // precisely because the vaguer reading cost a desktop: manganese read
    // "root" as an element with that id, looked one up, found nothing, and
    // threw before it rendered. Domicile writes no element for a shell to
    // mount into and does not mean to — a shell makes its own.
    ["a full-height body", "block-size: 100%;"],
  ])("always carries %s", (_, expected) => {
    expect(document()).toContain(expected);
  });

  // The module's name came off somebody's disk and lands in the most
  // privileged page here.
  it("escapes a module name that would close the tag", () => {
    const html = document('"></script><script>fetch("/steal")</script>');
    expect(html).not.toContain("<script>fetch");
    expect(html).not.toContain("</script><script>");
  });

  // THE FILE THE AUTHOR NAMED IS THE FILE THE BROWSER ASKS FOR, whatever is in
  // its name. This is the assertion the escaping alone did not make: `#`, `?`
  // and `%` are all legal in a POSIX filename and none of them is
  // HTML-special, so a module called `a#b.js` was written out verbatim, the
  // browser asked for `/a`, and the desktop came up blank with nothing in any
  // log. `%` failed differently and just as silently — the request reached the
  // bridge and its decode threw, so a file sitting right there answered 404.
  //
  // Asked by resolving the `src` the way a browser would and decoding it back,
  // rather than by pinning the escaped spelling: what has to hold is the round
  // trip, and which encoding gets there is not this module's contract.
  it.each([
    "shell.js",
    "a#b.js",
    "a?b.js",
    "a%b.js",
    "a b.js",
    "a&b.js",
    "índex.js",
  ])("asks for %s itself, not a prefix of it", (name) => {
    const src = /src="([^"]*)"/.exec(document(name))?.[1] ?? "";

    expect(decodeURIComponent(new URL(src, "http://host/").pathname)).toBe(
      `/${name}`,
    );
  });

  // And nothing reaches the markup as markup. The round-trip cases above are
  // what says the *right* file is asked for; this is what says no name can
  // become a tag on the way — which the encoding gives for free, since none of
  // `" < > &` survives it.
  it.each(['"></script><script>x', "a&b.js", "a<b.js"])(
    "writes %s as text, not as markup",
    (name) => {
      const src = /src="([^"]*)"/.exec(document(name))?.[1] ?? "";

      expect(src).not.toMatch(/["<>&]/);
    },
  );
});
