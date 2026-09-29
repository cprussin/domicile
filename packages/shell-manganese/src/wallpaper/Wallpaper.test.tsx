import { describe, expect, it, jest } from "bun:test";
import type { Theme } from "@domicile/component-library/theme-core";
import { THEMES } from "@domicile/component-library/theme-core";
import { act, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { WALLPAPER_PHOTOS } from "./photos";
import { Wallpaper } from "./Wallpaper";

/** How long one photograph is up, which is what a tick of the rotation is. */
const DWELL_MS = 60_000;

/**
 * The photograph at `index` in `theme`'s rotation, which is what these tests
 * are written against: what matters is which one of the list is up, not what
 * the list happens to hold.
 */
const photo = (theme: Theme, index: number): string => {
  const url = WALLPAPER_PHOTOS[theme][index];
  if (url === undefined) {
    throw new Error(
      `test: the ${theme} rotation has no photograph ${index.toString()}`,
    );
  } else {
    return url;
  }
};

/** The rotation shown in `theme`. */
const rotation = (container: HTMLElement, theme: Theme): Element => {
  const found = container.querySelector(`[data-wallpaper-theme="${theme}"]`);
  if (found === null) {
    throw new Error(`test: there is no ${theme} rotation`);
  } else {
    return found;
  }
};

/**
 * The photographs in one of `theme`'s rotation's three roles, in document
 * order.
 */
const layer = (
  container: HTMLElement,
  theme: Theme,
  role: string,
): (string | null)[] =>
  [
    ...rotation(container, theme).querySelectorAll(
      `img[data-wallpaper="${role}"]`,
    ),
  ].map((image) => image.getAttribute("src"));

describe("Wallpaper", () => {
  it("starts on the first photograph with every other one already loading", () => {
    // All of them mounted from the start, and that is the point: a layer that
    // appeared only when its turn came would be fetched at the moment it was
    // asked to fade in, so the fade would run over an image that had not
    // arrived. They cost one fetch each and the browser holds them after that.
    // The other theme's too, so a flip lands on a photograph already here.
    const { container } = render(<Wallpaper />);

    for (const theme of THEMES) {
      expect(layer(container, theme, "current")).toEqual([photo(theme, 0)]);
      expect(rotation(container, theme).querySelectorAll("img").length).toBe(
        WALLPAPER_PHOTOS[theme].length,
      );
    }
  });

  it("shows each theme's rotation only in that theme", () => {
    // Dark is the preset's base and light the `[data-theme=light]` condition,
    // so each rotation is one declaration away from the other. Hidden rather
    // than unmounted, which keeps it loaded — see the test above.
    const { container } = render(<Wallpaper />);

    expect(rotation(container, "dark").className).toContain(
      css({ _light: { display: "none" } }),
    );
    expect(rotation(container, "light").className).toContain(
      css({ _light: { display: "contents" }, display: "none" }),
    );
  });

  it("covers the whole desktop rather than a screen of it", () => {
    // Fixed, which on this page means the desktop: the viewport spans every
    // display, so one sheet is the whole wallpaper however many screens the
    // host described. Declarations rather than class names, because Panda
    // hashes them — the check is that the element carries *these rules*.
    const { container } = render(<Wallpaper />);
    const sheet = container.firstElementChild;

    expect(sheet?.className).toContain(css({ position: "fixed" }));
    expect(sheet?.className).toContain(css({ inset: 0 }));
  });

  // At the depth of the windows a tab is hiding rather than above it: they are
  // drawn over the wallpaper and under everything else, and a wallpaper over
  // them would show through a window opening or closing in front of one.
  it("sits at the depth a window a tab hides is drawn at", () => {
    const { container } = render(<Wallpaper />);

    expect(container.firstElementChild?.className).toContain(
      css({ zIndex: -2 }),
    );
  });

  it("fades the next photograph in over the one it is leaving", () => {
    // Both at once, in their two roles, because the one underneath is what
    // makes the dissolve clean: it stays opaque while the one above it rises,
    // so there is no moment where the desktop shows through between them.
    jest.useFakeTimers();
    const { container } = render(<Wallpaper />);

    act(() => {
      jest.advanceTimersByTime(DWELL_MS);
    });

    for (const theme of THEMES) {
      expect(layer(container, theme, "current")).toEqual([photo(theme, 1)]);
      expect(layer(container, theme, "previous")).toEqual([photo(theme, 0)]);
    }
    jest.useRealTimers();
  });

  it("comes back round to the first photograph at the end of the rotation", () => {
    // The turn the layers' document order cannot answer: the photograph coming
    // in is the *first* and the one going out is the last, so the one fading in
    // is the earlier element. Which is why `current` carries the stacking and
    // not the markup — see `Wallpaper.tsx`. Per theme, because the two
    // rotations need not be the same length.
    for (const theme of THEMES) {
      jest.useFakeTimers();
      const { container, unmount } = render(<Wallpaper />);
      const length = WALLPAPER_PHOTOS[theme].length;

      act(() => {
        jest.advanceTimersByTime(DWELL_MS * length);
      });

      expect(layer(container, theme, "current")).toEqual([photo(theme, 0)]);
      expect(layer(container, theme, "previous")).toEqual([
        photo(theme, length - 1),
      ]);
      unmount();
      jest.useRealTimers();
    }
  });
});
