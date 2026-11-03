import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";

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

  it("spaces the right column's items evenly, wider than the buttons' insets", () => {
    // Most items are 28px buttons around a 15px icon, so the space seen
    // between icons is the gap plus two 6.5px insets. Each item carries half
    // the gap on each side, so it closes with the item; the column pulls its
    // ends in by as much.
    const { container } = render(
      <TopBar layout={{ ...EMPTY, right: [<span key="c">c</span>] }} />,
    );

    const column = container.querySelector("header")?.lastElementChild;
    expect(column?.className).toContain(css({ marginInline: -2 }));
    expect(column?.firstElementChild?.firstElementChild?.className).toContain(
      css({ paddingInline: 2 }),
    );
  });

  it("grows the right column's items leftward, so their right edges stay put", () => {
    // A panel hung from an item's end then stays put as the item resizes.
    const { container } = render(
      <TopBar layout={{ ...EMPTY, right: [<span key="c">c</span>] }} />,
    );

    const column = container.querySelector("header")?.lastElementChild;
    expect(column?.firstElementChild?.className).toContain(
      css({ justifyContent: "flex-end" }),
    );
  });

  it("eases an item out when it stops showing anything", async () => {
    const Sharing = ({ shown }: { shown: boolean }) =>
      shown ? <button type="button">Sharing screen</button> : null;
    const bar = (shown: boolean) => (
      <TopBar
        layout={{ ...EMPTY, right: [<Sharing key="s" shown={shown} />] }}
      />
    );
    const { rerender } = render(bar(true));

    rerender(bar(false));
    await act(() => Promise.resolve());

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Sharing screen");
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
