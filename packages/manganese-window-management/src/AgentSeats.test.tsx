import { describe, expect, it, mock } from "bun:test";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentSeats } from "./AgentSeats";

/** The window the agent works in, and one beside it that is the user's. */
const REPORT = {
  appId: "report",
  depth: 4,
  frame: { height: 300, width: 400, x: 500, y: 40 },
};
const NOTES = {
  appId: "notes",
  depth: 0,
  frame: { height: 300, width: 400, x: 0, y: 40 },
};

const seat = (overrides: Partial<Seat> = {}): Seat => ({
  focused: "report",
  holds: ["report"],
  id: "agent-3",
  name: "Claude Code",
  pointer: { x: 600, y: 100 },
  taken: [],
  ...overrides,
});

const seats = (
  list: readonly Seat[],
  onGiveBack: (appId: string) => void = () => undefined,
) =>
  render(
    <AgentSeats
      onGiveBack={onGiveBack}
      seats={list}
      windows={[NOTES, REPORT]}
    />,
  );

describe("AgentSeats", () => {
  it("rings the window an agent works in, with its name", () => {
    const { container } = seats([seat()]);

    const ring = container.querySelector("[data-agent-ring]");
    expect(ring?.getAttribute("data-agent-ring")).toBe("report");
    expect(ring?.textContent).toBe("Claude Code");
    expect(container.querySelectorAll("[data-agent-ring]")).toHaveLength(1);
  });

  it("draws the ring over its window, under the next window up", () => {
    const { container } = seats([seat()]);

    const ring = container.querySelector<HTMLElement>("[data-agent-ring]");
    expect(ring?.style.zIndex).toBe("5");
    expect(ring?.style.insetInlineStart).toBe("500px");
    expect(ring?.style.inlineSize).toBe("400px");
  });

  it("draws the agent's pointer, named, where it points in a window it uses", () => {
    const { container } = seats([seat()]);

    const pointer = container.querySelector<HTMLElement>(
      "[data-agent-pointer]",
    );
    expect(pointer?.textContent).toBe("Claude Code");
    expect(pointer?.style.insetInlineStart).toBe("600px");
    expect(pointer?.style.insetBlockStart).toBe("100px");
  });

  it("hides the agent's pointer over a window it doesn't use", () => {
    const { container } = seats([seat({ pointer: { x: 100, y: 100 } })]);

    expect(container.querySelector("[data-agent-pointer]")).toBeNull();
  });

  it("hides the agent's pointer before it first points", () => {
    const { container } = seats([seat({ pointer: undefined })]);

    expect(container.querySelector("[data-agent-pointer]")).toBeNull();
  });

  it("tells the user a window they took is theirs, and gives it back", async () => {
    const onGiveBack = mock((_appId: string) => undefined);
    const { container } = seats(
      [seat({ focused: undefined, holds: [], taken: ["report"] })],
      onGiveBack,
    );

    expect(container.querySelector("[data-agent-ring]")).toBeNull();
    expect(screen.getByText("Yours now")).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: "Give back to Claude Code" }),
    );
    expect(onGiveBack.mock.calls).toStrictEqual([["report"]]);
  });

  it("closes the strip and keeps the window the user's", async () => {
    const onGiveBack = mock((_appId: string) => undefined);
    seats([seat({ holds: [], taken: ["report"] })], onGiveBack);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByText("Yours now")).toBeNull();
    expect(onGiveBack.mock.calls).toStrictEqual([]);
  });

  it("draws nothing for a window that isn't on screen", () => {
    const { container } = seats([
      seat({ holds: ["elsewhere"], pointer: undefined, taken: ["gone"] }),
    ]);

    expect(container.childElementCount).toBe(0);
  });
});
