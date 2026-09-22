import { describe, expect, it } from "bun:test";

describe("registerNodeInspection", () => {
  it("inspects an element as its own markup", () => {
    const element = document.createElement("p");
    element.className = "greeting";
    element.append("Hello");
    document.body.append(element);

    expect(Bun.inspect(element)).toBe(`<p class="greeting">Hello</p>`);
  });

  it("inspects a text node as its name and contents", () => {
    const element = document.createElement("p");
    element.append("Hello");
    document.body.append(element);

    expect(Bun.inspect(element.firstChild)).toBe(`#text "Hello"`);
  });

  it("inspects a comment as its name and contents", () => {
    const comment = document.createComment("a note");
    document.body.append(comment);

    expect(Bun.inspect(comment)).toBe(`#comment "a note"`);
  });

  it("inspects a document as the markup of its root element", () => {
    const element = document.createElement("p");
    element.append("Hello");
    document.body.append(element);

    expect(Bun.inspect(document)).toBe(document.documentElement.outerHTML);
  });

  it("inspects a fragment as its children", () => {
    const fragment = document.createDocumentFragment();
    const bold = document.createElement("b");
    bold.append("bold");
    const italic = document.createElement("i");
    italic.append("italic");
    fragment.append(bold, italic);

    expect(Bun.inspect(fragment)).toBe(`<b>bold</b><i>italic</i>`);
  });

  it("holds a detached node's inspection to the node itself", () => {
    // happy-dom nodes carry `ownerDocument` and window references, so
    // walking one reaches the whole rendered tree however small the node
    // is. A detached comment beside a large document is the sharpest
    // case: nothing about it is big, and it used to print the document.
    const filler = document.createElement("div");
    filler.innerHTML = "<span>padding</span>".repeat(500);
    document.body.append(filler);

    expect(Bun.inspect(document.createComment("x")).length).toBeLessThan(100);
  });
});
