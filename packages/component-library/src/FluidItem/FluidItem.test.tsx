import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import type { ObserveWidth } from "./FluidItem";
import { FluidItem } from "./FluidItem";

/** Widths reported by hand, since happy-dom lays nothing out. */
const fakeWidths = (initial: number) => {
  let report: (width: number) => void = () => undefined;
  const observe: ObserveWidth = (_element, onWidth) => {
    report = onWidth;
    onWidth(initial);
    return () => undefined;
  };
  return {
    observe,
    resize: (width: number) => {
      report(width);
    },
  };
};

const Item = ({
  observe,
  shown,
}: {
  observe: ObserveWidth;
  shown: boolean;
}) => (
  <FluidItem observeWidth={observe}>
    {shown && <button type="button">Downloads</button>}
  </FluidItem>
);

const slotOf = (container: HTMLElement) => {
  const slot = container.firstElementChild;
  if (!(slot instanceof HTMLElement)) {
    throw new Error("No slot");
  }
  return slot;
};

/** Lets the mutation observer, a microtask, see the last render. */
const settle = () => act(() => Promise.resolve());

const transitionEnd = (element: Element, propertyName: string) => {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
};

describe(FluidItem, () => {
  it("shows its content at the content's width", () => {
    const { observe } = fakeWidths(40);
    const { container } = render(<Item observe={observe} shown />);

    expect(screen.getByRole("button", { name: "Downloads" })).toBeVisible();
    expect(slotOf(container)).toHaveAttribute("data-shown");
    expect(slotOf(container).style.getPropertyValue("--fluid-width")).toBe(
      "40px",
    );
  });

  it("puts half its gap on each side, inside what closes", () => {
    const { observe } = fakeWidths(40);
    const { container } = render(
      <FluidItem gap="wide" observeWidth={observe}>
        <button type="button">Downloads</button>
      </FluidItem>,
    );

    expect(slotOf(container).firstElementChild?.className).toContain(
      css({ paddingInline: 2 }),
    );
  });

  it("keeps its content's end edge still when anchored at the end", () => {
    const { observe } = fakeWidths(40);
    const { container } = render(
      <FluidItem anchor="end" observeWidth={observe}>
        <button type="button">Downloads</button>
      </FluidItem>,
    );

    expect(slotOf(container).className).toContain(
      css({ justifyContent: "flex-end" }),
    );
  });

  it("clips its content to the eased width", () => {
    const { observe } = fakeWidths(40);
    const { container } = render(<Item observe={observe} shown />);

    expect(slotOf(container).className).toContain(css({ overflowX: "clip" }));
  });

  it("lets its content spill past the eased width when it overflows", () => {
    // For an item with open space beside it, whose own motion would be cut
    // off mid-resize.
    const { observe } = fakeWidths(40);
    const { container } = render(
      <FluidItem observeWidth={observe} overflow="visible">
        <button type="button">Downloads</button>
      </FluidItem>,
    );

    expect(slotOf(container).className).toContain(
      css({ overflowX: "visible" }),
    );
    expect(slotOf(container).className).not.toContain(
      css({ overflowX: "clip" }),
    );
  });

  it("follows its content's width as it changes", () => {
    const widths = fakeWidths(40);
    const { container } = render(<Item observe={widths.observe} shown />);

    widths.resize(64);

    expect(slotOf(container).style.getPropertyValue("--fluid-width")).toBe(
      "64px",
    );
  });

  it("closes to nothing while it has no content", () => {
    const { observe } = fakeWidths(0);
    const { container } = render(<Item observe={observe} shown={false} />);

    expect(slotOf(container)).not.toHaveAttribute("data-shown");
    expect(slotOf(container).style.getPropertyValue("--fluid-width")).toBe(
      "0px",
    );
  });

  describe("when its content goes", () => {
    it("keeps drawing it, out of reach, while it closes", async () => {
      const { observe } = fakeWidths(40);
      const { container, rerender } = render(<Item observe={observe} shown />);

      rerender(<Item observe={observe} shown={false} />);
      await settle();

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(container).toHaveTextContent("Downloads");
      expect(slotOf(container)).not.toHaveAttribute("data-shown");
      expect(slotOf(container).style.getPropertyValue("--fluid-width")).toBe(
        "0px",
      );
    });

    it("drops it once it has faded", async () => {
      const { observe } = fakeWidths(40);
      const { container, rerender } = render(<Item observe={observe} shown />);
      rerender(<Item observe={observe} shown={false} />);
      await settle();

      transitionEnd(slotOf(container), "width");
      expect(container).toHaveTextContent("Downloads");
      transitionEnd(slotOf(container), "opacity");
      expect(container).not.toHaveTextContent("Downloads");
    });

    it("ignores a fade inside it", async () => {
      const { observe } = fakeWidths(40);
      const { container, rerender } = render(<Item observe={observe} shown />);
      rerender(<Item observe={observe} shown={false} />);
      await settle();
      const leaving = container.querySelector("[inert]")?.firstElementChild;
      if (leaving === null || leaving === undefined) {
        throw new Error("Nothing leaving");
      }

      transitionEnd(leaving, "opacity");

      expect(container).toHaveTextContent("Downloads");
    });

    it("shows the new content if it comes back while closing", async () => {
      const widths = fakeWidths(40);
      const { container, rerender } = render(
        <Item observe={widths.observe} shown />,
      );
      rerender(<Item observe={widths.observe} shown={false} />);
      await settle();

      rerender(<Item observe={widths.observe} shown />);
      await settle();

      expect(
        screen.getAllByText("Downloads", { ignore: "[inert] *" }),
      ).toHaveLength(1);
      expect(container.querySelector("[inert]")).toBeEmptyDOMElement();
      expect(slotOf(container)).toHaveAttribute("data-shown");
      expect(slotOf(container).style.getPropertyValue("--fluid-width")).toBe(
        "40px",
      );
    });
  });
});
