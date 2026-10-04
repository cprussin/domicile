import { describe, expect, it } from "bun:test";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Brightness } from "./Brightness";

/**
 * A backlight the test holds the wire to: `watch` stands in for the host's,
 * `report` is the compositor saying a level, and `asked` is every level the
 * shell asked the desk for.
 */
const heldBacklight = () => {
  const listeners: ((level: number) => void)[] = [];
  const asked: number[] = [];
  return {
    asked,
    domicile: {
      setBrightness: (level: number) => {
        asked.push(level);
      },
    } as unknown as DomicileHost,
    report: (level: number) => {
      act(() => {
        for (const onLevel of listeners) {
          onLevel(level);
        }
      });
    },
    watch: (_domicile: DomicileHost, onLevel: (level: number) => void) => {
      listeners.push(onLevel);
      return () => undefined;
    },
  };
};

const opened = async (backlight: ReturnType<typeof heldBacklight>) => {
  render(<Brightness domicile={backlight.domicile} watch={backlight.watch} />);
  backlight.report(0.42);
  await userEvent.click(screen.getByRole("button", { name: "Brightness 42%" }));
  return screen.getByRole("slider", { name: "Brightness" });
};

describe("Brightness", () => {
  it("shows nothing on a machine that has said no brightness", () => {
    const backlight = heldBacklight();

    render(
      <Brightness domicile={backlight.domicile} watch={backlight.watch} />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
      <Brightness domicile={backlight.domicile} watch={backlight.watch} />,
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
      <Brightness domicile={backlight.domicile} watch={backlight.watch} />,
    );
    backlight.report(0.98);

    fireEvent.wheel(screen.getByRole("button"), { deltaY: -100 });

    expect(backlight.asked).toEqual([1]);
  });

  it("draws a plain sun that dims with the level", () => {
    const backlight = heldBacklight();
    render(
      <Brightness domicile={backlight.domicile} watch={backlight.watch} />,
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
