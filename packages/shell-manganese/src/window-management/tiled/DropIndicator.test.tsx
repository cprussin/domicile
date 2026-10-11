import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { recordedSettles } from "../recorded-settles";
import { DropIndicator } from "./DropIndicator";

const AIM = { height: 400, width: 600, x: 0, y: 32 };

describe("DropIndicator", () => {
  // Easing its size and place would lay it out every frame.
  it("takes the next aim's box at once, and eases into it from the last", () => {
    const { played, settler } = recordedSettles();
    const { rerender } = render(<DropIndicator rect={AIM} settler={settler} />);

    rerender(
      <DropIndicator rect={{ ...AIM, width: 300, x: 300 }} settler={settler} />,
    );

    expect(played).toStrictEqual([{ scaleX: 2, scaleY: 1, x: -150, y: 0 }]);
  });
});
