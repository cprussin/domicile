import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { Direction } from "../direction";
import { recordedSettles } from "../recorded-settles";
import { SettleHandoffs } from "../SettleHandoffs";
import { Aim } from "./aim";
import { DropIndicator } from "./DropIndicator";

const AIM = { height: 400, width: 600, x: 0, y: 32 };

const LINE = { height: 28, width: 4, x: 298, y: 2 };

const part = (
  container: HTMLElement,
  name: "box" | "fading" | "line",
): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-drop="${name}"]`);

describe("DropIndicator", () => {
  describe("settling", () => {
    // Easing its size and place would lay it out every frame.
    it("takes the next aim's box at once, and eases into it from the last", () => {
      const { played, settler } = recordedSettles();
      const { rerender } = render(
        <DropIndicator
          aim={Aim.Window("a", undefined, AIM)}
          settler={settler}
        />,
      );

      rerender(
        <DropIndicator
          aim={Aim.Window("a", Direction.Right, { ...AIM, width: 300, x: 300 })}
          settler={settler}
        />,
      );

      expect(played).toStrictEqual([{ scaleX: 2, scaleY: 1, x: -150, y: 0 }]);
    });

    // Scaled up to a box, a line's border and rounding would draw a blob.
    it("fades the box out where it was, and fades the line in where it goes", () => {
      const { played, settler } = recordedSettles();
      const { container, rerender } = render(
        <SettleHandoffs>
          <DropIndicator
            aim={Aim.Window("a", undefined, AIM)}
            settler={settler}
          />
        </SettleHandoffs>,
      );

      rerender(
        <SettleHandoffs>
          <DropIndicator
            aim={Aim.Tab("a", Direction.Left, LINE, 0)}
            settler={settler}
          />
        </SettleHandoffs>,
      );

      expect({
        box: part(container, "box") === null,
        fading: part(container, "fading")?.style.inlineSize,
        line: part(container, "line")?.style.inlineSize,
        played,
      }).toStrictEqual({ box: true, fading: "600px", line: "4px", played: [] });
    });

    it("grows the box out of a tab's line", () => {
      const { played, settler } = recordedSettles();
      const { container, rerender } = render(
        <SettleHandoffs>
          <DropIndicator
            aim={Aim.Tab("a", Direction.Left, LINE, 0)}
            settler={settler}
          />
        </SettleHandoffs>,
      );

      rerender(
        <SettleHandoffs>
          <DropIndicator
            aim={Aim.Window("a", undefined, AIM)}
            settler={settler}
          />
        </SettleHandoffs>,
      );

      expect({
        line: part(container, "line") === null,
        played,
      }).toStrictEqual({
        line: true,
        played: [{ scaleX: 4 / 600, scaleY: 28 / 400, x: 0, y: 16 - 232 }],
      });
    });
  });

  describe("depth", () => {
    // An open tab is raised over its window.
    it("is drawn over the open tabs of tiled windows", () => {
      const { container } = render(
        <DropIndicator aim={Aim.Window("a", undefined, AIM)} />,
      );

      expect(part(container, "box")?.style.zIndex).toBe("1");
    });

    it("is drawn over the open tab of the strip it aims at", () => {
      const { container } = render(
        <DropIndicator aim={Aim.Tab("a", Direction.Left, LINE, 4)} />,
      );

      expect(part(container, "line")?.style.zIndex).toBe("5");
    });
  });
});
