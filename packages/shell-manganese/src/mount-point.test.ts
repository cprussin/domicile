import { describe, expect, it } from "bun:test";

import { mountPoint } from "./mount-point";

// THE DOCUMENT DOMICILE WRITES, which is the whole of what this has to work
// against. Copied rather than imported because it comes from another package
// and this is a shell — every shell is in this position, and one that reached
// into the source of whatever writes it to find out what it was mounting
// into would be asserting a coupling that is not supposed to exist.
//
// What matters about it is the absence: an empty `<body>`, which is the root
// `Shell` is handed. The script that loads this module takes itself back out
// before it calls `Shell`, so the shape below is what a shell sees.
//
// Parsed, because a parsed document never runs its scripts. Built node by node
// with `createHTMLDocument`, happy-dom tries to load the script the moment it
// is appended, and logs that it cannot on every run.
const domicilesDocument = () =>
  new DOMParser().parseFromString(
    `<!doctype html><title>Domicile</title><body></body>`,
    "text/html",
  );

describe("mountPoint", () => {
  // THE BUG THIS EXISTS FOR. The entry point used to be
  // `document.getElementById("root")` and a throw — an id that came from an
  // `index.html` this shell no longer has. Domicile writes the document now
  // and writes no such element, so the lookup returned null on every real
  // launch, the module threw before React was reached, and the desktop was a
  // white window with the error only in a console nobody has open under
  // `--app`. Every check in the repository stayed green: the unit tests render
  // `<Shell>` into a container of their own making, and no end-to-end script
  // runs this shell.
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

  // NOT POSITIONED, AND THAT IS LOAD-BEARING. `<Screen>` is `position:
  // absolute` and placed in the desktop's coordinates, so it resolves against
  // the initial containing block — `Screen.tsx` says wrapping it in anything
  // relative, absolute or fixed reinterprets every position as an offset from
  // that wrapper, which looks like a desktop where every screen has slid.
  // A wrapper is exactly what this is, so it is the one that must not.
  it("is not a positioned ancestor", () => {
    const mounted = mountPoint(domicilesDocument().body);
    expect(mounted.style.position).toBe("");
  });

  // Called once per page in the entry point, but a second call returning a
  // second detached-from-nothing container would put two chromes on one
  // desktop, silently. Cheap to say it cannot.
  it("is the same element every time", () => {
    const document = domicilesDocument();
    expect(mountPoint(document.body)).toBe(mountPoint(document.body));
    expect(document.body.querySelectorAll("div")).toHaveLength(1);
  });
});
