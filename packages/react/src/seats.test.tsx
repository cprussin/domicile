import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { DomicileProvider } from "./domicile-provider";
import { useSeats } from "./seats";

const Agents = () => {
  const seats = useSeats();
  return (
    <span>
      {seats === undefined
        ? "unknown"
        : seats.map(({ name }) => name).join(", ") || "none"}
    </span>
  );
};

describe("useSeats", () => {
  it("is every agent seat, following each that comes or goes", () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <Agents />
      </DomicileProvider>,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();

    act(() => {
      fake.set({
        seats: [
          {
            focused: null,
            holds: [],
            id: "agent-3",
            name: "Claude Code",
            pointerX: null,
            pointerY: null,
            taken: [],
          },
        ],
      });
    });
    expect(screen.getByText("Claude Code")).toBeInTheDocument();

    act(() => {
      fake.set({ seats: [] });
    });
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});
