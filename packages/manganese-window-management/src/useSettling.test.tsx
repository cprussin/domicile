import { describe, expect, it } from "bun:test";
import { act, render, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { recordedSettles } from "./recorded-settles";
import type { Rect } from "./rect";
import { SettleHandoffs } from "./SettleHandoffs";
import type { Offset, Point } from "./settle";
import type { Settler } from "./useSettling";
import { useSettling } from "./useSettling";

const WAS = { height: 400, width: 600, x: 100, y: 50 };
const NOW = { height: 800, width: 1200, x: 0, y: 30 };
const CORNER = { x: 0, y: 0 };

type Props = {
  origin: Point | undefined;
  over?: number | undefined;
  rect: Rect | undefined;
  still: boolean;
};

/**
 * Renders the hook on an element, with a settler that finds it drawn at
 * `current` from its box.
 */
const settling = (
  first: Props,
  current?: Offset,
  element = { current: document.createElement("div") },
  onSettling?: (from: Rect | undefined) => void,
) => {
  const { ends, held, kept, played, settler } = recordedSettles(current);
  const { rerender } = renderHook(
    ({ origin, over, rect, still }: Props) => {
      useSettling({ element, onSettling, origin, over, rect, settler, still });
    },
    { initialProps: first },
  );
  return { ends, held, kept, played, rerender };
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

  // A window moving to another group passes over the strips on its way.
  it("holds the depth it is given while it eases", () => {
    const { held, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: false,
    });

    rerender({ origin: CORNER, over: 2, rect: NOW, still: false });

    expect(held).toStrictEqual([2]);
  });

  it("keeps its own depth while it eases unless given one", () => {
    const { held, rerender } = settling({
      origin: CORNER,
      rect: WAS,
      still: false,
    });

    rerender({ origin: CORNER, rect: NOW, still: false });

    expect(held).toStrictEqual([undefined]);
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

  // Text and icons would stretch with the box.
  it("keeps the parts marked upright at their own size", () => {
    const element = { current: document.createElement("div") };
    const title = document.createElement("span");
    title.toggleAttribute("data-upright", true);
    element.current.append(document.createElement("span"), title);
    const { kept, rerender } = settling(
      { origin: CORNER, rect: WAS, still: false },
      undefined,
      element,
    );

    rerender({ origin: CORNER, rect: NOW, still: false });

    expect(kept).toStrictEqual([[title]]);
  });

  // A window keeps its contents as big as the box drawn, and has the engine
  // show their frames without waiting, until the settle ends.
  it("says which box it eases from, until the settle ends", () => {
    const told: (Rect | undefined)[] = [];
    const { ends, rerender } = settling(
      { origin: CORNER, rect: WAS, still: false },
      undefined,
      undefined,
      (from) => {
        told.push(from);
      },
    );

    rerender({ origin: CORNER, rect: NOW, still: false });
    act(() => {
      ends[0]?.();
    });

    expect(told).toStrictEqual([WAS, undefined]);
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

  // A strip is drawn by its open tab, so it is a new element after a tab
  // switch. The new one takes over the old one's place.
  describe("an element that takes over from another", () => {
    type Part = {
      name: string;
      rect: Rect;
      shared?: readonly string[] | undefined;
      takesOver?: readonly string[] | undefined;
    };

    const Settled = ({
      rect,
      settler,
      shared,
      takesOver,
    }: Omit<Part, "name"> & { settler: Settler }) => {
      const element = useRef<HTMLDivElement | null>(null);
      useSettling({
        element,
        origin: CORNER,
        rect,
        settler,
        shared,
        still: false,
        takesOver,
      });
      return <div ref={element} />;
    };

    const swapped = (parts: readonly (Part | undefined)[][]) => {
      const { played, settler } = recordedSettles();
      const drawn = (shown: readonly (Part | undefined)[]) =>
        shown.map((part) =>
          part === undefined ? undefined : (
            <Settled
              key={part.name}
              rect={part.rect}
              settler={settler}
              shared={part.shared}
              takesOver={part.takesOver}
            />
          ),
        );
      const [first = [], ...rest] = parts;
      const { rerender } = render(
        <SettleHandoffs>{drawn(first)}</SettleHandoffs>,
      );
      for (const shown of rest) {
        rerender(<SettleHandoffs>{drawn(shown)}</SettleHandoffs>);
      }
      return played;
    };

    it("eases from where the element it replaces was drawn", () => {
      expect(
        swapped([
          [{ name: "one", rect: WAS, shared: ["a", "b"] }],
          [{ name: "two", rect: NOW, shared: ["b", "c"] }],
        ]),
      ).toStrictEqual([{ scaleX: 0.5, scaleY: 0.5, x: 100, y: 20 }]);
    });

    // A drop indicator's box grows out of the tab line it replaces, but a
    // line never grows out of a box.
    it("takes over a key it does not hand on", () => {
      expect(
        swapped([
          [{ name: "one", rect: WAS, shared: ["a"] }],
          [{ name: "two", rect: NOW, takesOver: ["a"] }],
          [{ name: "three", rect: WAS, shared: ["a"] }],
        ]),
      ).toStrictEqual([{ scaleX: 0.5, scaleY: 0.5, x: 100, y: 20 }]);
    });

    // Outside `SettleHandoffs`, as a part drawn on its own is.
    it("takes over nothing outside a scope that hands parts off", () => {
      const { played, settler } = recordedSettles();
      const { rerender } = render(
        <Settled key="one" rect={WAS} settler={settler} shared={["a"]} />,
      );

      rerender(
        <Settled key="two" rect={NOW} settler={settler} shared={["a"]} />,
      );

      expect(played).toStrictEqual([]);
    });

    it("takes over nothing from an element sharing no key", () => {
      expect(
        swapped([
          [{ name: "one", rect: WAS, shared: ["a"] }],
          [{ name: "two", rect: NOW, shared: ["b"] }],
        ]),
      ).toStrictEqual([]);
    });

    // A key left by an element gone long ago would fly the new one in from
    // somewhere unrelated.
    it("takes over nothing from an element gone before it came", () => {
      expect(
        swapped([
          [{ name: "one", rect: WAS, shared: ["a"] }],
          [],
          [{ name: "two", rect: NOW, shared: ["a"] }],
        ]),
      ).toStrictEqual([]);
    });
  });
});
