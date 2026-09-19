import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { Battery } from "./Battery";
import type { BatteryReading } from "./watch-battery";

/**
 * A battery the test holds the wire to: `watch` is what the component is
 * handed, and `report` is the machine answering — a charge that moved, or a
 * plug that went in or came out.
 */
const heldBattery = () => {
  const listeners: ((reading: BatteryReading) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    report: (reading: BatteryReading) => {
      act(() => {
        for (const onReading of listeners) {
          onReading(reading);
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
    watch: (onReading: (reading: BatteryReading) => void) => {
      listeners.push(onReading);
      return () => {
        watching.stopped += 1;
      };
    },
  };
};

/**
 * The readout: everything the charge is drawn in, which is what goes to danger
 * and what flashes. Taken off the container rather than off a role, because
 * what is being asked about is the whole group and only the meter inside it
 * has a role of its own.
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

    render(<Battery watch={battery.watch} />);

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows the charge as a percent and as a meter", () => {
    const battery = heldBattery();
    render(<Battery watch={battery.watch} />);

    battery.report({ charging: false, level: 0.873 });

    expect(screen.getByText("87%")).toBeVisible();
    expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
      "aria-valuenow",
      "87",
    );
  });

  it("marks the meter when AC is plugged in, and not when it is out", () => {
    const battery = heldBattery();
    render(<Battery watch={battery.watch} />);

    battery.report({ charging: true, level: 0.5 });

    expect(screen.getByRole("img", { name: "Charging" })).toBeVisible();

    battery.report({ charging: false, level: 0.5 });

    expect(
      screen.queryByRole("img", { name: "Charging" }),
    ).not.toBeInTheDocument();
  });

  it("follows the battery as it drains", () => {
    const battery = heldBattery();
    render(<Battery watch={battery.watch} />);

    battery.report({ charging: false, level: 0.42 });
    battery.report({ charging: false, level: 0.41 });

    expect(screen.getByText("41%")).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const battery = heldBattery();
    const { unmount } = render(<Battery watch={battery.watch} />);

    unmount();

    expect(battery.stopped).toBe(1);
  });

  describe("the charge running out", () => {
    it("turns the readout to danger at a tenth left", () => {
      const battery = heldBattery();
      const { container } = render(<Battery watch={battery.watch} />);

      battery.report({ charging: false, level: 0.11 });

      expect(readout(container).className).not.toContain(
        css({ color: "danger" }),
      );

      battery.report({ charging: false, level: 0.1 });

      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("flashes it at a twentieth, and not before", () => {
      const battery = heldBattery();
      const { container } = render(<Battery watch={battery.watch} />);

      battery.report({ charging: false, level: 0.06 });

      expect(readout(container).className).not.toContain(
        css({ animationName: "chargeFlashing" }),
      );

      battery.report({ charging: false, level: 0.05 });

      expect(readout(container).className).toContain(
        css({ animationName: "chargeFlashing" }),
      );
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("says so on the figures it shows rather than the level behind them", () => {
      // A tenth and a bit reads as `10%`, and a readout that said ten and
      // looked comfortable would be two answers to one question.
      const battery = heldBattery();
      const { container } = render(<Battery watch={battery.watch} />);

      battery.report({ charging: false, level: 0.104 });

      expect(screen.getByText("10%")).toBeVisible();
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("goes on saying so with the lead in", () => {
      // The bolt says the lead is in. What the colour is about is the cell,
      // and a machine that cannot be unplugged is not a machine that is fine.
      const battery = heldBattery();
      const { container } = render(<Battery watch={battery.watch} />);

      battery.report({ charging: true, level: 0.04 });

      expect(readout(container).className).toContain(css({ color: "danger" }));
      expect(readout(container).className).toContain(
        css({ animationName: "chargeFlashing" }),
      );
    });
  });
});
