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
    ["a full-height root", "block-size: 100%;"],
  ])("always carries %s", (_, expected) => {
    expect(document()).toContain(expected);
  });

  // The module's name came off somebody's disk and lands in the most
  // privileged page here.
  it("escapes a module name that would close the tag", () => {
    const html = document('"></script><script>fetch("/steal")</script>');
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&quot;&gt;&lt;/script&gt;");
  });

  // Ampersand first, or the escapes would escape each other's output and a
  // name with a legitimate `&` in it would break.
  it("escapes an ampersand once", () => {
    expect(document("a&b.js")).toContain('src="a&amp;b.js"');
  });
});
