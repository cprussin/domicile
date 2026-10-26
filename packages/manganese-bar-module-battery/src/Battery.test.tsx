import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { css } from "../styled-system/css";
import { Battery } from "./Battery";
import { heldBattery } from "./held-battery";

/** A test-controlled check for a battery. */
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

/** A check that never answers, for tests about UPower alone. */
const UNCHECKED = heldHardware().hardware;

/**
 * The readout container, which holds everything that turns red and flashes.
 * Only the meter inside has a role.
 */
const readout = (container: HTMLElement): Element => {
  const element = container.firstElementChild;
  if (element === null) {
    throw new Error("test: nothing was drawn");
  } else {
    return element;
  }
};

describe("Battery", () => {
  it("shows nothing until the machine has answered", () => {
    const battery = heldBattery();

    render(<Battery battery={battery.battery} hardware={UNCHECKED} />);

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows nothing for a machine without a battery", () => {
    const battery = heldBattery();
    const hardware = heldHardware();
    render(<Battery battery={battery.battery} hardware={hardware.hardware} />);

    hardware.report(Ok(false));
    battery.report({ charge: 0.5, charging: false });
    battery.absent();

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("says, dimmed, when UPower reports no battery the machine has", async () => {
    const battery = heldBattery();
    const hardware = heldHardware();
    render(<Battery battery={battery.battery} hardware={hardware.hardware} />);

    hardware.report(Ok(true));
    expect(
      screen.getByRole("img", { name: "Battery unavailable" }).className,
    ).toContain(css({ opacity: "inactive" }));

    battery.absent();
    await userEvent.hover(
      screen.getByRole("img", { name: "Battery unavailable" }),
    );
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Battery unavailable");
  });

  it("shows the charge as a percent and as a meter", () => {
    const battery = heldBattery();
    render(<Battery battery={battery.battery} hardware={UNCHECKED} />);

    battery.report({ charge: 0.873, charging: false });

    expect(screen.getByText("87%")).toBeVisible();
    expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
      "aria-valuenow",
      "87",
    );
  });

  it("insets itself like the bar's icon buttons, so the gaps beside it match", () => {
    const battery = heldBattery();
    const { container } = render(
      <Battery battery={battery.battery} hardware={UNCHECKED} />,
    );

    battery.report({ charge: 0.5, charging: false });

    expect(readout(container).className).toContain(css({ paddingInline: 1.5 }));
  });

  it("marks the meter when AC is plugged in, and not when it is out", () => {
    const battery = heldBattery();
    render(<Battery battery={battery.battery} hardware={UNCHECKED} />);

    battery.report({ charge: 0.5, charging: true });

    expect(
      within(screen.getByRole("meter", { name: "Battery" })).getByRole("img", {
        name: "Charging",
      }),
    ).toBeVisible();

    battery.report({ charge: 0.5, charging: false });

    expect(
      screen.queryByRole("img", { name: "Charging" }),
    ).not.toBeInTheDocument();
  });

  it("keeps room for its widest percentage", () => {
    // `100%` is the widest, so the item never grows past it.
    const battery = heldBattery();
    render(<Battery battery={battery.battery} hardware={UNCHECKED} />);

    battery.report({ charge: 0.5, charging: false });

    expect(screen.getByText("100%").closest("[aria-hidden]")).not.toBeNull();
    expect(
      screen.queryByRole("img", { name: "Charging" }),
    ).not.toBeInTheDocument();
  });

  it("follows the battery as it drains", () => {
    const battery = heldBattery();
    render(<Battery battery={battery.battery} hardware={UNCHECKED} />);

    battery.report({ charge: 0.42, charging: false });
    battery.report({ charge: 0.41, charging: false });

    expect(screen.getByText("41%")).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const battery = heldBattery();
    const { unmount } = render(
      <Battery battery={battery.battery} hardware={UNCHECKED} />,
    );

    unmount();

    expect(battery.stopped).toBe(1);
  });

  describe("the charge running out", () => {
    it("turns the readout to danger at a tenth left", () => {
      const battery = heldBattery();
      const { container } = render(
        <Battery battery={battery.battery} hardware={UNCHECKED} />,
      );

      battery.report({ charge: 0.11, charging: false });

      expect(readout(container).className).not.toContain(
        css({ color: "danger" }),
      );

      battery.report({ charge: 0.1, charging: false });

      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("flashes it at a twentieth, and not before", () => {
      const battery = heldBattery();
      const { container } = render(
        <Battery battery={battery.battery} hardware={UNCHECKED} />,
      );

      battery.report({ charge: 0.06, charging: false });

      expect(readout(container).className).not.toContain(
        css({ animationName: "chargeFlashing" }),
      );

      battery.report({ charge: 0.05, charging: false });

      expect(readout(container).className).toContain(
        css({ animationName: "chargeFlashing" }),
      );
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("says so on the figures it shows rather than the level behind them", () => {
      // 10.4% displays as `10%`, so the color must agree with that.
      const battery = heldBattery();
      const { container } = render(
        <Battery battery={battery.battery} hardware={UNCHECKED} />,
      );

      battery.report({ charge: 0.104, charging: false });

      expect(screen.getByText("10%")).toBeVisible();
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("stops saying so once the lead is in", () => {
      // A charging battery needs no warning.
      const battery = heldBattery();
      const { container } = render(
        <Battery battery={battery.battery} hardware={UNCHECKED} />,
      );

      battery.report({ charge: 0.04, charging: true });

      expect(readout(container).className).not.toContain(
        css({ color: "danger" }),
      );
      expect(readout(container).className).not.toContain(
        css({ animationName: "chargeFlashing" }),
      );
    });
  });
});
