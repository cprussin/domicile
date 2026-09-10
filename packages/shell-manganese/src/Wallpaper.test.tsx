import { describe, expect, it, jest } from "bun:test";
import { act, render } from "@testing-library/react";

import { css } from "../styled-system/css";
import { Wallpaper } from "./Wallpaper";
import { WALLPAPER_PHOTOS } from "./wallpaper-photos";

/** How long one photograph is up, which is what a tick of the rotation is. */
const DWELL_MS = 60_000;

/**
 * The photograph at `index` in the rotation, which is what these tests are
 * written against: what matters is which one of the list is up, not what the
 * list happens to hold.
 */
const photo = (index: number): string => {
  const url = WALLPAPER_PHOTOS[index];
  if (url === undefined) {
    throw new Error(`test: the rotation has no photograph ${index.toString()}`);
  } else {
    return url;
  }
};

/** The photographs in one of the rotation's three roles, in document order. */
const layer = (container: HTMLElement, role: string): (string | null)[] =>
  [...container.querySelectorAll(`img[data-wallpaper="${role}"]`)].map(
    (image) => image.getAttribute("src"),
  );

describe("Wallpaper", () => {
  it("starts on the first photograph with every other one already loading", () => {
    // All of them mounted from the start, and that is the point: a layer that
    // appeared only when its turn came would be fetched at the moment it was
    // asked to fade in, so the fade would run over an image that had not
    // arrived. They cost one fetch each and the browser holds them after that.
    const { container } = render(<Wallpaper />);

    expect(layer(container, "current")).toEqual([photo(0)]);
    expect(container.querySelectorAll("img").length).toBe(
      WALLPAPER_PHOTOS.length,
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

  it("fades the next photograph in over the one it is leaving", () => {
    // Both at once, in their two roles, because the one underneath is what
    // makes the dissolve clean: it stays opaque while the one above it rises,
    // so there is no moment where the desktop shows through between them.
    jest.useFakeTimers();
    const { container } = render(<Wallpaper />);

    act(() => {
      jest.advanceTimersByTime(DWELL_MS);
    });

    expect(layer(container, "current")).toEqual([photo(1)]);
    expect(layer(container, "previous")).toEqual([photo(0)]);
    jest.useRealTimers();
  });

  it("comes back round to the first photograph at the end of the rotation", () => {
    // The turn the layers' document order cannot answer: the photograph coming
    // in is the *first* and the one going out is the last, so the one fading in
    // is the earlier element. Which is why `current` carries the stacking and
    // not the markup — see `Wallpaper.tsx`.
    jest.useFakeTimers();
    const { container } = render(<Wallpaper />);

    act(() => {
      jest.advanceTimersByTime(DWELL_MS * WALLPAPER_PHOTOS.length);
    });

    expect(layer(container, "current")).toEqual([photo(0)]);
    expect(layer(container, "previous")).toEqual([
      photo(WALLPAPER_PHOTOS.length - 1),
    ]);
    jest.useRealTimers();
  });
});
