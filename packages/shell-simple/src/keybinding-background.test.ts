import { describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/register-elements";

import { installKeybindingBackground } from "./keybinding-background";

/** What the background says, as the chord/meaning pairs a reader sees. */
const legend = (root: HTMLElement): [chord: string, means: string][] =>
  [...root.querySelectorAll("dt")].map((term) => [
    term.textContent ?? "",
    term.nextElementSibling?.textContent ?? "",
  ]);

const freshRoot = (): HTMLElement => {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
};

describe("installKeybindingBackground", () => {
  it("writes every combination this shell answers to, and what it does", () => {
    // The desktop paints nothing else, so this is the only place a user is
    // told that Alt is what the whole interface hangs off.
    const root = freshRoot();
    installKeybindingBackground(root);
    expect(legend(root)).toStrictEqual([
      ["Alt + press", "raise"],
      ["Alt + drag", "move (and raise)"],
      ["Alt + right-drag", "resize (and raise)"],
      ["Alt + Enter", "open a terminal"],
    ]);
  });

  it("hides against the tag the SDK actually registers", () => {
    // The rule that unpaints the legend over a window is a selector, and Panda
    // extracts a selector key as a build-time literal — so the module spells
    // the tag out rather than reading it from here. Nothing else would notice
    // the SDK renaming it: no type error, no failing test, and a legend
    // composited over a live client.
    expect(APP_TAG_NAME).toBe("domicile-app");
  });

  it("goes on the desktop itself, not in a wrapper of its own", () => {
    // What unpaints the legend over a window is a sibling selector, so the
    // windows have to be the background's own siblings. Anything between the
    // two — a container, a root that is not the desktop — leaves the legend
    // painted over every window, and nothing else would say so.
    const root = freshRoot();
    installKeybindingBackground(root);
    expect(root.querySelector("dl")?.parentElement?.parentElement).toBe(root);
  });
});
