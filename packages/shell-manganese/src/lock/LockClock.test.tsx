import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { LockClock } from "./LockClock";

describe("LockClock", () => {
  it("reads the hour and minute large, and the day under them", () => {
    // No seconds: a figure that size changing every second is a screen that
    // never sits still while nobody is at it.
    render(<LockClock now={() => new Date(2026, 8, 16, 8, 3, 40)} />);

    expect(screen.getByText("08:03")).toBeVisible();
    expect(screen.getByText("Wednesday, September 16")).toBeVisible();
  });
});
