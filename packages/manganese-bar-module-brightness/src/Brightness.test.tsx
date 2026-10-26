import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { css } from "../styled-system/css";
import { Brightness } from "./Brightness";
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

/** A test-controlled check for a backlight. */
const heldHardware = () => {
  const listeners: ((present: Result<boolean, SystemError>) => void)[] = [];
  return {
    hardware: sharedWatch(
      (onPresent: (present: Result<boolean, SystemError>) => void) => {
        listeners.push(onPresent);
        return () => undefined;
      },
    ),
    report: (present: Result<boolean, SystemError>) => {
      act(() => {
        for (const onPresent of listeners) {
          onPresent(present);
        }
      });
    },
  };
};

/** A check that never answers, for tests about the level alone. */
const UNCHECKED = heldHardware().hardware;

const opened = async (backlight: ReturnType<typeof heldBacklight>) => {
  render(
    <Brightness
      backlight={backlight.backlight}
      hardware={UNCHECKED}
      nightLight={testNightLight()}
    />,
  );
  backlight.report(0.42);
  await userEvent.click(screen.getByRole("button", { name: "Brightness 42%" }));
  return screen.getByRole("slider", { name: "Brightness" });
};

describe("Brightness", () => {
  it("opens the night light alone on a machine without a backlight", async () => {
    const backlight = heldBacklight();
    const hardware = heldHardware();
    render(
      <Brightness
        backlight={backlight.backlight}
        hardware={hardware.hardware}
        nightLight={testNightLight()}
      />,
    );
    hardware.report(Ok(false));

    await userEvent.click(
      screen.getByRole("button", { name: "Night light off" }),
    );
    await userEvent.click(screen.getByRole("switch", { name: "Night light" }));

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Night light on" }),
    ).toBeInTheDocument();
  });

  it("turns the night light on beside the slider", async () => {
    const backlight = heldBacklight();
    await opened(backlight);

    await userEvent.click(screen.getByRole("switch", { name: "Night light" }));

    expect(screen.getByRole("switch", { name: "Night light" })).toBeChecked();
  });

  it("says, dimmed, when a backlight has no level to show", async () => {
    const backlight = heldBacklight();
    const hardware = heldHardware();

    render(
      <Brightness
        backlight={backlight.backlight}
        hardware={hardware.hardware}
        nightLight={testNightLight()}
      />,
    );
    hardware.report(Ok(true));

    expect(
      screen.getByRole("img", { name: "Brightness unavailable" }).className,
    ).toContain(css({ opacity: "inactive" }));
    await userEvent.hover(
      screen.getByRole("img", { name: "Brightness unavailable" }),
    );
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Brightness unavailable");
  });

  it("opens a slider at the level the desk is at", async () => {
    const backlight = heldBacklight();

    const slider = await opened(backlight);

    expect(slider).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeVisible();
  });

  it("asks the desk for the level the slider is moved to", async () => {
    const backlight = heldBacklight();
    const slider = await opened(backlight);

    slider.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(backlight.asked).toEqual([0.43]);
  });

  it("follows the desk when the brightness moves elsewhere", async () => {
    const backlight = heldBacklight();
    const slider = await opened(backlight);

    backlight.report(0.7);

    expect(slider).toHaveAttribute("aria-valuenow", "70");
  });

  it("steps by a twentieth from wherever the wheel left it", () => {
    const backlight = heldBacklight();
    render(
      <Brightness
        backlight={backlight.backlight}
        hardware={UNCHECKED}
        nightLight={testNightLight()}
      />,
    );
    backlight.report(0.42);
    const icon = screen.getByRole("button", { name: "Brightness 42%" });

    fireEvent.wheel(icon, { deltaY: -100 });
    fireEvent.wheel(icon, { deltaY: 100 });

    expect(backlight.asked).toEqual([0.47, 0.42]);
  });

  it("never asks past either end", () => {
    const backlight = heldBacklight();
    render(
      <Brightness
        backlight={backlight.backlight}
        hardware={UNCHECKED}
        nightLight={testNightLight()}
      />,
    );
    backlight.report(0.98);

    fireEvent.wheel(screen.getByRole("button"), { deltaY: -100 });

    expect(backlight.asked).toEqual([1]);
  });

  it("draws a bulb that dims with the level", () => {
    const backlight = heldBacklight();
    render(
      <Brightness
        backlight={backlight.backlight}
        hardware={UNCHECKED}
        nightLight={testNightLight()}
      />,
    );
    const icon = () => screen.getByRole("button", { name: /^Brightness/ });

    backlight.report(0.2);
    expect(icon()).toHaveAttribute("data-intensity", "dim");
    backlight.report(0.5);
    expect(icon()).toHaveAttribute("data-intensity", "half");
    backlight.report(0.9);
    expect(icon()).toHaveAttribute("data-intensity", "full");
  });

  it("hangs its slider in a panel drawn like the bar", async () => {
    const backlight = heldBacklight();

    await opened(backlight);

    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-tone",
      "overPhoto",
    );
  });

  it("closes when a click lands in a page", async () => {
    const backlight = heldBacklight();
    const page = document.createElement("webview");
    document.body.append(page);
    await opened(backlight);

    fireEvent.focusIn(page);

    await waitForElementToBeRemoved(() => screen.queryByRole("slider"));
    page.remove();
  });
});
