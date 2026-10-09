import { describe, expect, it, jest } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";

import { Layer } from "./layer";
import { Photo } from "./Photo";

/** Longest wait between attempts to load a photograph, in ms. */
const MAX_RETRY_MS = 60_000;

const SRC = "https://commons.wikimedia.org/wiki/Special:FilePath/Sky.jpg";

/** The photograph's `<img>`. */
const image = (container: HTMLElement): Element => {
  const found = container.querySelector("img");
  if (found === null) {
    throw new Error("test: the photograph has no <img>");
  } else {
    return found;
  }
};

/** Fails the current attempt and returns the `<img>` that failed. */
const fail = (container: HTMLElement): Element => {
  const failed = image(container);
  fireEvent.error(failed);
  return failed;
};

/** Advances fake time by `ms`. */
const wait = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe("Photo", () => {
  it("stays transparent until it has loaded", () => {
    // A photograph that has not loaded would draw nothing over the one from
    // the repository.
    const { container } = render(<Photo layer={Layer.Current} src={SRC} />);

    expect(image(container).getAttribute("data-wallpaper")).toBe(Layer.Waiting);

    fireEvent.load(image(container));

    expect(image(container).getAttribute("data-wallpaper")).toBe(Layer.Current);
  });

  describe("retrying after a failed load", () => {
    // The network may be down, or up with no route to the internet, for any
    // length of time. Each retry is a new `<img>`, so a new request.

    it("retries after a second, then waits twice as long each time", () => {
      jest.useFakeTimers();
      const { container } = render(<Photo layer={Layer.Current} src={SRC} />);

      const first = fail(container);
      wait(999);
      expect(image(container)).toBe(first);
      wait(1);
      expect(image(container)).not.toBe(first);

      const second = fail(container);
      wait(1999);
      expect(image(container)).toBe(second);
      wait(1);
      expect(image(container)).not.toBe(second);
      jest.useRealTimers();
    });

    it("waits at most a minute between attempts", () => {
      jest.useFakeTimers();
      const { container } = render(<Photo layer={Layer.Current} src={SRC} />);

      for (let attempt = 0; attempt < 10; attempt++) {
        fail(container);
        wait(MAX_RETRY_MS);
      }
      const last = fail(container);
      wait(MAX_RETRY_MS);

      expect(image(container)).not.toBe(last);
      jest.useRealTimers();
    });

    it("shows the photograph once a retry loads it", () => {
      jest.useFakeTimers();
      const { container } = render(<Photo layer={Layer.Current} src={SRC} />);

      fail(container);
      wait(1000);
      fireEvent.load(image(container));

      expect(image(container).getAttribute("src")).toBe(SRC);
      expect(image(container).getAttribute("data-wallpaper")).toBe(
        Layer.Current,
      );
      jest.useRealTimers();
    });
  });
});
