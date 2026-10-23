import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { Direction } from "../direction";
import { recordedSettles } from "../recorded-settles";
import { Aim } from "./aim";
import { DropIndicator } from "./DropIndicator";

const AIM = { height: 400, width: 600, x: 0, y: 32 };

const depthOf = (container: HTMLElement): string | undefined =>
  container.querySelector<HTMLElement>("[data-drop]")?.style.zIndex;

describe("DropIndicator", () => {
  // Easing its size and place would lay it out every frame.
  it("takes the next aim's box at once, and eases into it from the last", () => {
    const { played, settler } = recordedSettles();
    const { rerender } = render(
      <DropIndicator aim={Aim.Window("a", undefined, AIM)} settler={settler} />,
    );

    rerender(
      <DropIndicator
        aim={Aim.Window("a", Direction.Right, { ...AIM, width: 300, x: 300 })}
        settler={settler}
      />,
    );

    expect(played).toStrictEqual([{ scaleX: 2, scaleY: 1, x: -150, y: 0 }]);
  });

  // An open tab is raised over its window.
  it("is drawn over the open tabs of tiled windows", () => {
    const { container } = render(
      <DropIndicator aim={Aim.Window("a", undefined, AIM)} />,
    );

    expect(depthOf(container)).toBe("1");
  });

  it("is drawn over the open tab of the strip it aims at", () => {
    const { container } = render(
      <DropIndicator aim={Aim.Tab("a", Direction.Left, AIM, 4)} />,
    );

    expect(depthOf(container)).toBe("5");
  });
});
