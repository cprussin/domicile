import { describe, expect, it, mock } from "bun:test";
import type { Seat } from "@domicile-desktop/sdk/desktop/seats";
import { fireEvent, render, screen } from "@testing-library/react";
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

const transitionEnd = (element: Element, propertyName: string) => {
  // happy-dom's `TransitionEvent` drops `propertyName`.
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  fireEvent(element, event);
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
    seats(
      [seat({ focused: undefined, holds: [], taken: ["report"] })],
      onGiveBack,
    );

    expect(screen.getByText("You're using this window")).toBeDefined();
    expect(
      screen.getByText("Claude Code is paused here until you give it back."),
    ).toBeDefined();
    await userEvent.click(
      screen.getByRole("button", { name: "Give back to Claude Code" }),
    );
    expect(onGiveBack.mock.calls).toStrictEqual([["report"]]);
  });

  it("turns the ring of a window the user took amber, and names it paused", () => {
    const { container } = seats([seat({ holds: [], taken: ["report"] })]);

    const ring = container.querySelector("[data-agent-ring]");
    expect(ring?.hasAttribute("data-paused")).toBe(true);
    expect(ring?.textContent).toBe("Claude Code · Paused");
  });

  it("keeps the same ring as a window is taken and given back, so it turns in place", () => {
    const { container, rerender } = seats([seat()]);
    const before = container.querySelector("[data-agent-ring]");

    rerender(
      <AgentSeats
        onGiveBack={() => undefined}
        seats={[seat({ taken: ["report"] })]}
        windows={[NOTES, REPORT]}
      />,
    );

    expect(container.querySelector("[data-agent-ring]")).toBe(before);
    expect(before?.hasAttribute("data-paused")).toBe(true);
  });

  it("hides the banner and keeps the window the user's, with its amber ring", async () => {
    const onGiveBack = mock((_appId: string) => undefined);
    const { container } = seats(
      [seat({ holds: [], taken: ["report"] })],
      onGiveBack,
    );

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    const banner = screen.getByRole("status");
    expect(banner.hasAttribute("data-leaving")).toBe(true);
    transitionEnd(banner, "translate");

    expect(screen.queryByText("You're using this window")).toBeNull();
    expect(
      container.querySelector("[data-agent-ring]")?.hasAttribute("data-paused"),
    ).toBe(true);
    expect(onGiveBack.mock.calls).toStrictEqual([]);
  });

  it("slides the banner out once the window is given back, then drops it", () => {
    const { rerender } = seats([seat({ taken: ["report"] })]);

    rerender(
      <AgentSeats
        onGiveBack={() => undefined}
        seats={[seat()]}
        windows={[NOTES, REPORT]}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner.hasAttribute("data-leaving")).toBe(true);
    expect(banner.hasAttribute("inert")).toBe(true);

    transitionEnd(banner, "translate");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the banner again the next time the user takes the window", async () => {
    const { rerender } = seats([seat({ taken: ["report"] })]);
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    transitionEnd(screen.getByRole("status"), "translate");

    const again = (taken: readonly string[]) => {
      rerender(
        <AgentSeats
          onGiveBack={() => undefined}
          seats={[seat({ taken })]}
          windows={[NOTES, REPORT]}
        />,
      );
    };
    again([]);
    again(["report"]);

    expect(screen.getByText("You're using this window")).toBeDefined();
  });

  it("fades a ring out once the agent lets go of its window, then drops it", () => {
    const { container, rerender } = seats([seat()]);

    rerender(
      <AgentSeats
        onGiveBack={() => undefined}
        seats={[seat({ holds: [], pointer: undefined })]}
        windows={[NOTES, REPORT]}
      />,
    );
    const ring = container.querySelector("[data-agent-ring]");
    expect(ring?.hasAttribute("data-leaving")).toBe(true);

    if (ring !== null) {
      transitionEnd(ring, "opacity");
    }
    expect(container.querySelector("[data-agent-ring]")).toBeNull();
  });

  it("grays the agent's pointer over a window the user took from it", () => {
    const { container } = seats([seat({ taken: ["report"] })]);

    expect(
      container
        .querySelector("[data-agent-pointer]")
        ?.hasAttribute("data-paused"),
    ).toBe(true);
  });

  it("draws nothing for a window that isn't on screen", () => {
    const { container } = seats([
      seat({ holds: ["elsewhere"], pointer: undefined, taken: ["gone"] }),
    ]);

    expect(container.childElementCount).toBe(0);
  });
});
