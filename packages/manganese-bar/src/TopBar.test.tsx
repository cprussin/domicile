import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { css } from "../styled-system/css";
import { TopBar } from "./TopBar";

const EMPTY = { center: [], left: [], right: [] };

describe("TopBar", () => {
  it("lays out each column's items in order", () => {
    render(
      <TopBar
        layout={{
          center: [<span key="clock">clock</span>],
          left: [<span key="a">a</span>, <span key="b">b</span>],
          right: [<span key="c">c</span>],
        }}
      />,
    );

    expect(
      [...screen.getByRole("banner").children].map(
        (column) => column.textContent,
      ),
    ).toEqual(["ab", "clock", "c"]);
  });

  it("draws its text white, with a shadow to keep it off the wallpaper", () => {
    // The bar has no background, so the shadow separates text from the
    // wallpaper. Checked by declarations because Panda hashes class names.
    const { container } = render(<TopBar layout={EMPTY} />);

    const bar = container.querySelector("header");
    expect(bar?.className).toContain(css({ color: "white" }));
    expect(bar?.className).toContain(css({ textShadow: "textOverPhoto" }));
  });

  it("hangs a scrim below itself so the text survives a bright wallpaper", () => {
    // The text shadow alone is too thin for a bright wallpaper. The scrim
    // extends below the bar so the gradient is not weakest under the text,
    // so it is a separate layer that ignores the pointer.
    const { container } = render(<TopBar layout={EMPTY} />);

    expect(container.querySelector("header")?.className).toContain(
      css({
        "&::before": {
          backgroundImage: "{gradients.scrimOverPhoto}",
          content: '""',
          insetBlockEnd: -4,
          insetBlockStart: 0,
          insetInline: 0,
          pointerEvents: "none",
          position: "absolute",
          zIndex: -1,
        },
      }),
    );
  });
});
