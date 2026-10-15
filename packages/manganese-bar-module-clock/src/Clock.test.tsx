import { describe, expect, it, jest } from "bun:test";
import { act, render, screen } from "@testing-library/react";

import { Clock } from "./Clock";
import { ClockOptionsContext } from "./clock-options";

describe("Clock", () => {
  it("shows the reading of the time it is handed", () => {
    render(<Clock now={() => new Date(2026, 8, 16, 20, 53, 40)} />);

    expect(screen.getByText("Wednesday 2026-09-16 20:53:40")).toBeVisible();
  });

  it("reads its format from ClockOptionsContext", () => {
    render(
      <ClockOptionsContext value={{ format: "12h", seconds: false }}>
        <Clock now={() => new Date(2026, 8, 16, 20, 53, 40)} />
      </ClockOptionsContext>,
    );

    expect(screen.getByText("Wednesday 2026-09-16 08:53 PM")).toBeVisible();
  });

  it("ticks every second", () => {
    jest.useFakeTimers();
    const readings = [
      new Date(2026, 8, 16, 20, 53, 40),
      new Date(2026, 8, 16, 20, 53, 41),
    ];
    render(
      <Clock
        now={() => readings.shift() ?? new Date(2026, 8, 16, 20, 53, 41)}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Wednesday 2026-09-16 20:53:41")).toBeVisible();
    jest.useRealTimers();
  });
});
