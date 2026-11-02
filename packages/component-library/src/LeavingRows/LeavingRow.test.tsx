import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { LeavingRow } from "./LeavingRow";

const row = (motion: Parameters<typeof LeavingRow>[0]["motion"]) =>
  render(
    <ul>
      <LeavingRow motion={motion}>
        <button type="button">Open</button>
      </LeavingRow>
    </ul>,
  );

const transitionEnd = (element: Element, propertyName: string) => {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
};

describe(LeavingRow, () => {
  it("is a list item, usable while it stays", () => {
    row({ arriving: false, leaving: undefined, onLeft: () => undefined });

    expect(screen.getByRole("listitem")).not.toHaveAttribute("data-leaving");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("says it arrives, so the stylesheet slides it in", () => {
    row({ arriving: true, leaving: undefined, onLeft: () => undefined });

    expect(screen.getByRole("listitem")).toHaveAttribute("data-arriving");
  });

  it("is out of reach while it leaves", () => {
    row({ arriving: false, leaving: 0, onLeft: () => undefined });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("li[data-leaving]")).toBeInTheDocument();
  });

  it("has left once its height has closed", () => {
    let left = 0;
    row({
      arriving: false,
      leaving: 0,
      onLeft: () => {
        left += 1;
      },
    });
    const item = document.querySelector("li");
    if (item === null) {
      throw new Error("No row");
    }

    transitionEnd(item, "opacity");
    expect(left).toBe(0);
    transitionEnd(item, "grid-template-rows");
    expect(left).toBe(1);
  });

  it("ignores a transition inside it", () => {
    let left = 0;
    row({
      arriving: false,
      leaving: 0,
      onLeft: () => {
        left += 1;
      },
    });
    const button = document.querySelector("button");
    if (button === null) {
      throw new Error("No button");
    }

    transitionEnd(button, "grid-template-rows");
    expect(left).toBe(0);
  });
});
