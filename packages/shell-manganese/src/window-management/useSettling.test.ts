import { describe, expect, it } from "bun:test";
import { renderHook } from "@testing-library/react";
import { recordedSettles } from "./recorded-settles";
import type { Rect } from "./rect";
import type { Offset, Point } from "./settle";
import { useSettling } from "./useSettling";

const WAS = { height: 400, width: 600, x: 100, y: 50 };
const NOW = { height: 800, width: 1200, x: 0, y: 30 };
const CORNER = { x: 0, y: 0 };

type Props = {
  origin: Point | undefined;
  rect: Rect | undefined;
  still: boolean;
};

/**
 * Renders the hook on an element, with a settler that finds it drawn at
 * `current` from its box.
 */
const settling = (first: Props, current?: Offset) => {
  const { played, settler } = recordedSettles(current);
  const element = { current: document.createElement("div") };
  const { rerender } = renderHook(
    ({ origin, rect, still }: Props) => {
      useSettling(element, rect, origin, still, settler);
    },
    { initialProps: first },
  );
  return { played, rerender };
};

describe("useSettling", () => {
  it("does nothing for a box that has not moved", () => {
    const { played, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: false,
    });

    rerender({ origin: CORNER, rect: { ...WAS }, still: false });

    expect(played).toStrictEqual([]);
  });

  it("eases from the old box into the new one", () => {
    const { played, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: false,
    });

    rerender({ origin: CORNER, rect: NOW, still: false });

    expect(played).toStrictEqual([{ scaleX: 0.5, scaleY: 0.5, x: 100, y: 20 }]);
  });

  // A box that changes during a settle eases on from where it is drawn, not
  // from where it was laid out.
  it("eases on from where it is drawn when the box changes again", () => {
    const { played, rerender } = settling(
      { origin: CORNER, rect: WAS, still: false },
      { scaleX: 1, scaleY: 1, x: -100, y: -50 },
    );

    rerender({ origin: CORNER, rect: NOW, still: false });

    expect(played).toStrictEqual([{ scaleX: 0.5, scaleY: 0.5, x: 0, y: -30 }]);
  });

  // A box that follows the pointer would trail it.
  it("stops easing while the box is held still", () => {
    const { played, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: true,
    });

    rerender({ origin: CORNER, rect: NOW, still: true });

    expect(played).toStrictEqual([undefined]);
  });

  // A window back from off screen has its own arrival.
  it("does not ease a box that comes back on screen", () => {
    const { played, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: false,
    });

    rerender({ origin: CORNER, rect: undefined, still: false });
    rerender({ origin: CORNER, rect: NOW, still: false });

    expect(played).toStrictEqual([]);
  });
});
