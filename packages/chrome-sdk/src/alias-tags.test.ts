import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { aliasTag } from "./alias-tags";

// A stand-in for `<app>` -> `<domicile-app>`: the upgrade mechanics are what
// is under test, and an unregistered target keeps a real custom element's
// lifecycle out of the way.
const ALIAS = "app";
const REAL = "alias-target";

// `MutationObserver` delivers on a microtask, as it does in a real browser.
const settle = (): Promise<void> => Promise.resolve();

describe("aliasTag", () => {
  // Each case installs an observer on the shared document; leaving one running
  // would upgrade the next case's elements behind its back.
  let releases: (() => void)[] = [];
  const alias = (): (() => void) => {
    const release = aliasTag(document.body, ALIAS, REAL);
    releases.push(release);
    return release;
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    releases = [];
  });

  afterEach(() => {
    for (const release of releases) {
      release();
    }
  });

  it("upgrades an element already in the document", () => {
    document.body.innerHTML = `<${ALIAS} app-id="term"></${ALIAS}>`;

    alias();

    expect(document.body.querySelector(ALIAS)).toBeNull();
    expect(document.body.querySelector(REAL)?.getAttribute("app-id")).toBe(
      "term",
    );
  });

  it("carries the element's children across", () => {
    document.body.innerHTML = `<${ALIAS}><span id="kept"></span></${ALIAS}>`;

    alias();

    expect(document.body.querySelector(`${REAL} > #kept`)).not.toBeNull();
  });

  it("upgrades an element added later", async () => {
    alias();

    document.body.append(document.createElement(ALIAS));
    await settle();

    expect(document.body.querySelector(REAL)).not.toBeNull();
    expect(document.body.querySelector(ALIAS)).toBeNull();
  });

  it("upgrades an element nested inside one added later", async () => {
    alias();

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<${ALIAS} app-id="editor"></${ALIAS}>`;
    document.body.append(wrapper);
    await settle();

    expect(document.body.querySelector(REAL)?.getAttribute("app-id")).toBe(
      "editor",
    );
  });

  it("stops upgrading once released", async () => {
    const release = alias();
    release();

    document.body.append(document.createElement(ALIAS));
    await settle();

    expect(document.body.querySelector(ALIAS)).not.toBeNull();
  });
});
