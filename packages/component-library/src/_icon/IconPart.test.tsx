import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { IconPart } from "./IconPart";

const pathOf = (container: HTMLElement) => container.querySelector("path");

describe(IconPart, () => {
  it("draws its path, marked with its name", () => {
    const { container } = render(
      <svg>
        <IconPart d="M1 1Z" name="dot" />
      </svg>,
    );
    expect(container.querySelector("[data-part=dot] path")).toHaveAttribute(
      "d",
      "M1 1Z",
    );
  });

  it("marks its state, for its styles", () => {
    const { container } = render(
      <svg>
        <IconPart d="M1 1Z" name="arc" state="unlit" />
      </svg>,
    );
    expect(container.querySelector("[data-part=arc]")).toHaveAttribute(
      "data-state",
      "unlit",
    );
  });

  it("replays its cue by drawing afresh on each one", () => {
    const { container, rerender } = render(
      <svg>
        <IconPart cue={0} d="M1 1Z" name="dot" />
      </svg>,
    );
    const first = pathOf(container);
    expect(container.querySelector("[data-cued]")).toBeNull();
    rerender(
      <svg>
        <IconPart cue={1} d="M1 1Z" name="dot" />
      </svg>,
    );
    expect(container.querySelector("[data-cued]")).not.toBeNull();
    expect(pathOf(container)).not.toBe(first);
  });

  it("gives its direction to its styles", () => {
    const { container } = render(
      <svg>
        <IconPart d="M1 1Z" direction={[-1, 1]} name="square" />
      </svg>,
    );
    const part = container.querySelector<SVGGElement>("[data-part=square]");
    expect(part?.style.getPropertyValue("--part-x")).toBe("-1");
    expect(part?.style.getPropertyValue("--part-y")).toBe("1");
  });
});
