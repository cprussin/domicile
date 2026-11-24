import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { fireEvent, render, screen } from "@testing-library/react";

import { springTransition } from "../__test__/spring-transition";
import type { RowMotion } from "./LeavingRow";
import { LeavingRow } from "./LeavingRow";
import type { Leaving } from "./leaving-rows";

const STAYING: RowMotion = {
  arriving: false,
  leaving: undefined,
  onClosed: () => undefined,
  onSlid: () => undefined,
  rise: 0,
};

const SLIDING: Leaving = { closed: false, order: 0, room: undefined };

/** Its list's rows: one moving as `motion` does, then one that stays. */
const rows = (motion: Partial<RowMotion>) =>
  render(
    <ul>
      <LeavingRow motion={{ ...STAYING, ...motion }}>
        <button type="button">Open</button>
      </LeavingRow>
      <LeavingRow motion={STAYING}>Below</LeavingRow>
    </ul>,
  );

/** The first row, which moves as `rows` was given. */
const first = (): HTMLElement => {
  const item = document.querySelector("li");
  if (item === null) {
    throw new Error("No row");
  } else {
    return item;
  }
};

/** The element that slides, inside the first row. */
const body = (): Element => {
  const slides = first().firstElementChild;
  if (slides === null) {
    throw new Error("The row is empty");
  } else {
    return slides;
  }
};

const transitionEnd = (element: Element, propertyName: string) => {
  // happy-dom's `TransitionEvent` drops `propertyName`.
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
};

/** Puts the rows `top` pixels down their list, as layout would. */
const placeAt = (top: Record<string, number>) => {
  for (const row of document.querySelectorAll("li")) {
    Object.defineProperty(row, "offsetTop", {
      value: top[row.textContent],
    });
  }
};

describe(LeavingRow, () => {
  it("is a list item, usable while it stays", () => {
    rows({});

    expect(first()).not.toHaveAttribute("data-leaving");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("says it arrives, so the stylesheet slides it in", () => {
    rows({ arriving: true });

    expect(first()).toHaveAttribute("data-arriving");
  });

  it("is out of reach while it leaves", () => {
    rows({ leaving: SLIDING });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(first()).toHaveAttribute("data-leaving");
  });

  it("says the room it takes, to the next row's top, once it has slid out", async () => {
    const room = await new Promise((resolve) => {
      rows({ leaving: SLIDING, onSlid: resolve });
      placeAt({ Below: 52, Open: 8 });

      transitionEnd(body(), "transform");
    });

    expect(room).toBe(44);
  });

  it("ignores a transition inside it", () => {
    let slid = 0;
    rows({
      leaving: SLIDING,
      onSlid: () => {
        slid += 1;
      },
    });

    transitionEnd(screen.getByRole("button", { hidden: true }), "transform");
    expect(slid).toBe(0);
  });

  it("has closed once its own collapse, timed with the rise over it, ends", async () => {
    await new Promise<void>((resolve) => {
      rows({ leaving: { ...SLIDING, room: 44 }, onClosed: resolve });

      transitionEnd(first(), "scale");
    });

    expect(first()).toHaveAttribute("data-closing");
  });

  describe("motion", () => {
    loadEmittedStylesheet(
      document,
      new URL("../../styled-system/styles.css", import.meta.url),
    );

    it("rises over the rows closing above it on the snappy spring", () => {
      rows({ rise: 44 });

      const { transition, translate } = globalThis.getComputedStyle(first());
      expect(translate).toBe("0 calc(-1 * 44px)");
      expect(transition).toBe(springTransition("translate", "snappy"));
    });

    it("drops its rise at once, as the rows it rose over go", () => {
      rows({});

      expect(globalThis.getComputedStyle(first()).transition).not.toContain(
        "translate",
      );
    });

    it("collapses, out of sight, with the rise over it, rising no more itself", () => {
      rows({ leaving: { ...SLIDING, room: 44 }, rise: 20 });

      expect(globalThis.getComputedStyle(first()).transition).toBe(
        springTransition("scale", "snappy"),
      );
    });

    it("slides out on the snappy spring", () => {
      rows({ leaving: SLIDING });

      expect(globalThis.getComputedStyle(body()).transition).toContain(
        springTransition("transform", "snappy"),
      );
    });
  });
});
