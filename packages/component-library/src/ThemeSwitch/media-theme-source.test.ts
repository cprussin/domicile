import { describe, expect, it } from "bun:test";
import type { MediaQuery } from "./media-theme-source";
import { followReducedMotion, mediaThemeSource } from "./media-theme-source";
import type { Theme } from "./theme-core";

/** A media query whose match `set` changes, telling its listeners. */
const fakeQuery = (matches: boolean) => {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query: MediaQuery = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    matches,
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const set = (next: boolean) => {
    query.matches = next;
    for (const listener of listeners) {
      listener({ matches: next });
    }
  };
  return { listeners, query, set };
};

describe(mediaThemeSource, () => {
  it("reads the theme from whether the light scheme matches", () => {
    expect(mediaThemeSource(fakeQuery(true).query).theme).toBe("light");
    expect(mediaThemeSource(fakeQuery(false).query).theme).toBe("dark");
  });

  it("reports each change until stopped", async () => {
    const { listeners, query, set } = fakeQuery(false);
    const source = mediaThemeSource(query);
    const told = await new Promise<Theme>((resolve) => {
      const stop = source.onTheme(resolve);
      set(true);
      stop();
    });
    expect(told).toBe("light");
    expect(listeners.size).toBe(0);
  });

  it("can't set the desktop's theme", () => {
    expect(() => {
      mediaThemeSource(fakeQuery(false).query).setTheme("light");
    }).toThrow("The desktop's theme is set by the desktop");
  });
});

describe(followReducedMotion, () => {
  it("marks the page while reduced motion is asked for", () => {
    const { query, set } = fakeQuery(true);
    const root = document.createElement("html");
    const stop = followReducedMotion(query, root);
    expect(root).toHaveAttribute("data-reduced-motion");
    set(false);
    expect(root).not.toHaveAttribute("data-reduced-motion");
    stop();
    set(true);
    expect(root).not.toHaveAttribute("data-reduced-motion");
  });
});
