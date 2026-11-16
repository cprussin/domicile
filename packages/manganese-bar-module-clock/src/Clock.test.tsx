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

  it("without seconds, reads the clock only on the minute", () => {
    jest.useFakeTimers();
    let reads = 0;
    render(
      <ClockOptionsContext value={{ format: "24h", seconds: false }}>
        <Clock
          now={() => {
            reads += 1;
            // 20 s before the minute, then on it.
            return reads === 1
              ? new Date(2026, 8, 16, 20, 53, 40)
              : new Date(2026, 8, 16, 20, 54, 0);
          }}
        />
      </ClockOptionsContext>,
    );

    act(() => {
      jest.advanceTimersByTime(19_999);
    });
    expect(reads).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(reads).toBe(2);
    expect(screen.getByText("Wednesday 2026-09-16 20:54")).toBeVisible();
    jest.useRealTimers();
  });
});
