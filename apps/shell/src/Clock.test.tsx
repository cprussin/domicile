import { describe, expect, it, jest } from "bun:test";
import { act, render, screen } from "@testing-library/react";

import { Clock } from "./Clock";

const at = (iso: string): Date => new Date(iso);

describe("Clock", () => {
  it("shows the time it is handed", () => {
    render(<Clock now={() => at("2026-08-17T13:45:07Z")} />);
    expect(
      screen.getByText(at("2026-08-17T13:45:07Z").toLocaleTimeString()),
    ).toBeInTheDocument();
  });

  it("keeps the time current as it runs", () => {
    jest.useFakeTimers();
    const readings = [at("2026-08-17T13:45:07Z"), at("2026-08-17T13:45:08Z")];
    render(
      <Clock now={() => readings.shift() ?? at("2026-08-17T13:45:08Z")} />,
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText(at("2026-08-17T13:45:08Z").toLocaleTimeString()),
    ).toBeInTheDocument();
    jest.useRealTimers();
  });
});
