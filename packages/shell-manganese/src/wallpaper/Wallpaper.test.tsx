import { describe, expect, it, jest } from "bun:test";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { act, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { WALLPAPER_PHOTOS } from "./photos";
import { Wallpaper } from "./Wallpaper";

/** How long each photograph shows; one rotation tick. */
const DWELL_MS = 60_000;

/** Crossfade duration in ms. */
const CROSSFADE_MS = Number.parseFloat(token("durations.crossfade")) * 1000;

/**
 * The photograph at `index` in `theme`'s rotation. Tests check positions in
 * the list, not its contents.
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

/** The photographs in `theme`'s rotation with `role`, in document order. */
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
    // Every photograph mounts up front so it has loaded before it fades in.
    // This includes the other theme's, so a theme switch shows a loaded image.
    const { container } = render(<Wallpaper />);

    for (const theme of THEMES) {
      expect(layer(container, theme, "current")).toEqual([photo(theme, 0)]);
      expect(rotation(container, theme).querySelectorAll("img").length).toBe(
        WALLPAPER_PHOTOS[theme].length,
      );
    }
  });

  it("shows each theme's rotation only in that theme", () => {
    // Hidden rather than unmounted, so the photographs stay loaded.
    const { container } = render(<Wallpaper />);

    expect(rotation(container, "dark").className).toContain(
      css({ _light: { display: "none" } }),
    );
    expect(rotation(container, "light").className).toContain(
      css({ _light: { display: "contents" }, display: "none" }),
    );
  });

  it("covers the whole desktop rather than a screen of it", () => {
    // The viewport spans every display, so one fixed sheet covers all screens.
    // Checks for the classes `css()` emits for these declarations, since Panda
    // hashes class names.
    const { container } = render(<Wallpaper />);
    const sheet = container.firstElementChild;

    expect(sheet?.className).toContain(css({ position: "fixed" }));
    expect(sheet?.className).toContain(css({ inset: 0 }));
  });

  // Windows hidden behind a tab sit at this depth. A wallpaper above them
  // would show through a window opening or closing in front of one.
  it("sits at the depth a window a tab hides is drawn at", () => {
    const { container } = render(<Wallpaper />);

    expect(container.firstElementChild?.className).toContain(
      css({ zIndex: -2 }),
    );
  });

  it("fades the next photograph in over the one it is leaving", () => {
    // The previous photograph stays opaque underneath while the next fades
    // in, so the background never shows through mid-fade.
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
    // On wrap-around the incoming photograph is earlier in the document, so
    // stacking must come from the role, not document order. Checked per theme
    // because the rotations can differ in length.
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

  it("puts the one it left away once the fade is over", () => {
    // Each photograph must be transparent before its turn. Otherwise a
    // rotation of two would cut instead of fade, and a longer one could fade
    // out over the incoming photograph.
    for (const theme of THEMES) {
      jest.useFakeTimers();
      const { container, unmount } = render(<Wallpaper />);

      // Two steps: the fade timer starts in the render after the tick.
      act(() => {
        jest.advanceTimersByTime(DWELL_MS);
      });
      act(() => {
        jest.advanceTimersByTime(CROSSFADE_MS);
      });

      expect(layer(container, theme, "current")).toEqual([photo(theme, 1)]);
      expect(layer(container, theme, "previous")).toEqual([]);
      expect(layer(container, theme, "waiting")).toContain(photo(theme, 0));
      unmount();
      jest.useRealTimers();
    }
  });

  it("fades only the photograph coming in", () => {
    // Other role changes happen under an opaque photograph. A transition on
    // them could draw over the incoming photograph.
    const { container } = render(<Wallpaper />);
    const image = container.querySelector("img");

    expect(image?.className).toContain(
      css({
        '&[data-wallpaper="current"]': {
          transition: "opacity {durations.crossfade} {easings.in-out}",
        },
      }),
    );
  });
});
