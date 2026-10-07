import { describe, expect, it } from "bun:test";

import { applyAppearance } from "./appearance";

const PLAIN = {
  accentColor: undefined,
  highContrast: false,
  reducedMotion: false,
};

describe("applyAppearance", () => {
  it("sets the accent and clears it again", () => {
    const root = document.createElement("html");

    applyAppearance({ ...PLAIN, accentColor: "#3584e4" }, root);
    expect(root.getAttribute("style")).toContain("#3584e4");

    applyAppearance(PLAIN, root);
    expect(root.getAttribute("style") ?? "").not.toContain("#3584e4");
  });

  it("marks high contrast and reduced motion, and unmarks them", () => {
    const root = document.createElement("html");

    applyAppearance(
      { ...PLAIN, highContrast: true, reducedMotion: true },
      root,
    );
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(root.hasAttribute("data-reduced-motion")).toBe(true);

    applyAppearance(PLAIN, root);
    expect(root.hasAttribute("data-contrast")).toBe(false);
    expect(root.hasAttribute("data-reduced-motion")).toBe(false);
  });
});
