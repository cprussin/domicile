import { describe, expect, it } from "bun:test";

import { mountPoint } from "./mount-point";

// THE DOCUMENT DOMICILE WRITES, which is the whole of what this has to work
// against. Copied rather than imported because it comes from another package
// and this is a shell — every shell is in this position, and one that reached
// into the bridge's source to find out what it was mounting into would be
// asserting a coupling that is not supposed to exist.
//
// What matters about it is the absence: a `<body>` with a script in it and
// nothing else. `shell-document.ts` says so in prose ("what is in it is only
// what a desktop cannot do without") and the shape below is that list.
const domicilesDocument = () => {
  const written = document.implementation.createHTMLDocument("Domicile");
  // Built as a node rather than parsed from a string: the body Domicile writes
  // holds a script tag, and handing that to `innerHTML` makes happy-dom's
  // parser complain about a detached document on every run.
  const loads = written.createElement("script");
  loads.setAttribute("src", "shell.js");
  loads.setAttribute("type", "module");
  written.body.append(loads);
  return written;
};

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
    expect(() => mountPoint(document)).not.toThrow();
  });

  it("puts what it returns in the document", () => {
    const document = domicilesDocument();
    const mounted = mountPoint(document);
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
    const mounted = mountPoint(domicilesDocument());
    expect(mounted.style.position).toBe("");
  });

  // Called once per page in the entry point, but a second call returning a
  // second detached-from-nothing container would put two chromes on one
  // desktop, silently. Cheap to say it cannot.
  it("is the same element every time", () => {
    const document = domicilesDocument();
    expect(mountPoint(document)).toBe(mountPoint(document));
    expect(document.body.querySelectorAll("div")).toHaveLength(1);
  });
});
