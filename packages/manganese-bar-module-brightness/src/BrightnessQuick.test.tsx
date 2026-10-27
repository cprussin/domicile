import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrightnessRow, NightLightTile } from "./BrightnessQuick";
import { heldBacklight } from "./held-backlight";
import { nightLight } from "./night-light";

/** A night light that keeps its override in memory and tints nothing. */
const testNightLight = () =>
  nightLight({
    every: () => () => undefined,
    now: () => new Date("2026-10-25T15:00"),
    store: () => undefined,
    stored: () => undefined,
    tint: () => undefined,
  });

describe(BrightnessRow, () => {
  it("shows the slider once the backlight has a level", () => {
    const backlight = heldBacklight();
    render(<BrightnessRow backlight={backlight.backlight} />);
    expect(screen.queryByRole("slider")).toBeNull();

    backlight.report(0.42);

    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue(
      "42",
    );
  });
});

describe(NightLightTile, () => {
  it("turns the night light on and off", async () => {
    render(<NightLightTile nightLight={testNightLight()} />);
    const tile = screen.getByRole("button", { name: "Night light" });
    expect(tile).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(tile);

    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("On")).toBeInTheDocument();
  });
});
