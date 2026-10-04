import { describe, expect, it } from "bun:test";

import { mountPoint } from "./mount-point";

// The document Domicile generates: an empty `<body>`, which is the root `Shell`
// receives. The loader script removes itself before calling `Shell`. Copied
// rather than imported so the shell does not depend on Domicile's source.
//
// Built with `DOMParser`, not `createHTMLDocument`: happy-dom tries to load
// scripts appended to a built document and logs an error.
const domicilesDocument = () =>
  new DOMParser().parseFromString(
    `<!doctype html><title>Domicile</title><body></body>`,
    "text/html",
  );

describe("mountPoint", () => {
  // Domicile's document has no `#root` element. A lookup by id would return
  // null, throw before React renders and leave a blank window, while tests that
  // render into their own container still pass.
  it("does not need an element the document does not have", () => {
    const document = domicilesDocument();
    expect(document.getElementById("root")).toBeNull();
    expect(() => mountPoint(document.body)).not.toThrow();
  });

  it("puts what it returns in the root", () => {
    const document = domicilesDocument();
    const mounted = mountPoint(document.body);
    expect(mounted.isConnected).toBe(true);
    expect(mounted.parentElement).toBe(document.body);
  });

  // Must not be positioned. `<Screen>` is absolutely positioned in desktop
  // coordinates against the initial containing block; a positioned wrapper
  // would offset every screen. See `Screen.tsx`.
  it("is not a positioned ancestor", () => {
    const mounted = mountPoint(domicilesDocument().body);
    expect(mounted.style.position).toBe("");
  });

  // A second call must not create a second container, or two chromes would
  // render on one desktop.
  it("is the same element every time", () => {
    const document = domicilesDocument();
    expect(mountPoint(document.body)).toBe(mountPoint(document.body));
    expect(document.body.querySelectorAll("div")).toHaveLength(1);
  });
});
