import { describe, expect, it, jest } from "bun:test";
import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { THEMES } from "@domicile-desktop/component-library/theme-core";
import { act, fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { OnOneScreen } from "../screens/fixture";
import { WALLPAPER_FALLBACKS, WALLPAPER_PHOTOS } from "./photos";
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

/** Finishes loading every photograph in `container`. */
const loadPhotos = (container: HTMLElement) => {
  for (const image of container.querySelectorAll("img")) {
    fireEvent.load(image);
  }
};

describe("Wallpaper", () => {
  it("shows the picture an application set instead of the rotation", () => {
    const { container } = render(<Wallpaper picture="blob:sky" />, {
      wrapper: OnOneScreen,
    });

    expect(container.querySelector("[data-wallpaper-theme]")).toBeNull();
    expect(
      [...container.querySelectorAll("img")].map((image) =>
        image.getAttribute("src"),
      ),
    ).toEqual(["blob:sky"]);
  });

  it("starts on the first photograph with only the next one loading", () => {
    // The next photograph mounts a whole step early so it has loaded before it
    // fades in. The rest stay unmounted, so dozens of 4K photographs are not
    // held at once. The other theme's mount too, so a theme switch shows a
    // loaded image.
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });
    loadPhotos(container);

    for (const theme of THEMES) {
      expect(layer(container, theme, "current")).toEqual([photo(theme, 0)]);
      expect(layer(container, theme, "waiting")).toEqual([photo(theme, 1)]);
    }
  });

  it("shows each theme's rotation only in that theme", () => {
    // Hidden rather than unmounted, so the photographs stay loaded.
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });

    expect(rotation(container, "dark").className).toContain(
      css({ _light: { display: "none" } }),
    );
    expect(rotation(container, "light").className).toContain(
      css({ _light: { display: "contents" }, display: "none" }),
    );
  });

  it("covers each screen and not the gaps between them", () => {
    // Monitors of different sizes leave gaps in the page. A photograph over
    // the whole page would be drawn there too, and cropped to the page's
    // shape rather than each monitor's.
    const { container } = render(<Wallpaper />, {
      wrapper: ({ children }) => (
        <DisplayProvider
          source={{
            displays: [
              { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
              {
                name: "right",
                position: [1920, 120],
                scale: 2,
                size: [2560, 1440],
              },
            ],
            onDisplays: () => () => undefined,
          }}
        >
          {children}
        </DisplayProvider>
      ),
    });
    const screens = [
      ...(container.firstElementChild?.querySelectorAll<HTMLElement>(
        ":scope > *",
      ) ?? []),
    ];

    expect(
      screens.map(({ style: { height, left, top, width } }) => ({
        height,
        left,
        top,
        width,
      })),
    ).toEqual([
      { height: "1080px", left: "0px", top: "0px", width: "1920px" },
      { height: "1440px", left: "1920px", top: "120px", width: "2560px" },
    ]);
    for (const screen of screens) {
      expect(screen.querySelectorAll("img").length).toBe(
        // The current, next and repository photographs, for each theme.
        THEMES.length * 3,
      );
    }
  });

  // Windows hidden behind a tab sit at this depth. A wallpaper above them
  // would show through a window opening or closing in front of one.
  it("sits at the depth a window a tab hides is drawn at", () => {
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });

    expect(container.firstElementChild?.className).toContain(
      css({ zIndex: -2 }),
    );
  });

  it("fades the next photograph in over the one it is leaving", () => {
    // The previous photograph stays opaque underneath while the next fades
    // in, so the background never shows through mid-fade.
    jest.useFakeTimers();
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });
    loadPhotos(container);

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
      const { container, unmount } = render(<Wallpaper />, {
        wrapper: OnOneScreen,
      });
      const length = WALLPAPER_PHOTOS[theme].length;

      // Each photograph loads while it is next.
      for (let tick = 0; tick < length; tick++) {
        loadPhotos(container);
        act(() => {
          jest.advanceTimersByTime(DWELL_MS);
        });
      }

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
    // rotation of two would cut instead of fade. A longer one unmounts it
    // until its next turn comes near.
    for (const theme of THEMES) {
      jest.useFakeTimers();
      const { container, unmount } = render(<Wallpaper />, {
        wrapper: OnOneScreen,
      });
      loadPhotos(container);

      // Two steps: the fade timer starts in the render after the tick.
      act(() => {
        jest.advanceTimersByTime(DWELL_MS);
      });
      act(() => {
        jest.advanceTimersByTime(CROSSFADE_MS);
      });

      expect(layer(container, theme, "current")).toEqual([photo(theme, 1)]);
      expect(layer(container, theme, "previous")).toEqual([]);
      expect(layer(container, theme, "waiting")).toEqual([
        photo(theme, 2 % WALLPAPER_PHOTOS[theme].length),
      ]);
      unmount();
      jest.useRealTimers();
    }
  });

  it("fades only the photograph coming in", () => {
    // Other role changes happen under an opaque photograph. A transition on
    // them could draw over the incoming photograph.
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });
    const image = container.querySelector('img[data-wallpaper="waiting"]');

    expect(image?.className).toContain(
      css({
        '&[data-wallpaper="current"]': {
          transition: "opacity {durations.crossfade} {easings.in-out}",
        },
      }),
    );
  });

  it("shows a photograph from the repository under each theme's rotation", () => {
    // Without a network no photograph loads, so the desktop shows this one.
    const { container } = render(<Wallpaper />, { wrapper: OnOneScreen });

    for (const theme of THEMES) {
      expect(layer(container, theme, "fallback")).toEqual([
        WALLPAPER_FALLBACKS[theme],
      ]);
    }
  });
});
