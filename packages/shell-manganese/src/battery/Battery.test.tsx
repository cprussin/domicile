import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { BatteryMessage } from "@domicile/chrome-sdk/host-message";
import { act, render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { Battery } from "./Battery";

/**
 * A battery the test holds the wire to: `watch` is what the component is
 * handed in place of the one that listens to the host, and `report` is the
 * compositor saying a charge — one that moved, or a plug that went in or came
 * out.
 */
const heldBattery = () => {
  const listeners: ((reading: BatteryMessage) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    report: (reading: BatteryMessage) => {
      act(() => {
        for (const onReading of listeners) {
          onReading(reading);
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
    watch: (
      _domicile: DomicileClient,
      onReading: (reading: BatteryMessage) => void,
    ) => {
      listeners.push(onReading);
      return () => {
        watching.stopped += 1;
      };
    },
  };
};

/**
 * The client, which these cases never reach: `watch` is injected, so what the
 * component does with this is hand it straight back.
 */
const NO_HOST = {} as DomicileClient;

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

    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows the charge as a percent and as a meter", () => {
    const battery = heldBattery();
    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    battery.report({ charge: 0.873, charging: false });

    expect(screen.getByText("87%")).toBeVisible();
    expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
      "aria-valuenow",
      "87",
    );
  });

  it("marks the meter when AC is plugged in, and not when it is out", () => {
    const battery = heldBattery();
    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    battery.report({ charge: 0.5, charging: true });

    expect(screen.getByRole("img", { name: "Charging" })).toBeVisible();

    battery.report({ charge: 0.5, charging: false });

    expect(
      screen.queryByRole("img", { name: "Charging" }),
    ).not.toBeInTheDocument();
  });

  it("follows the battery as it drains", () => {
    const battery = heldBattery();
    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    battery.report({ charge: 0.42, charging: false });
    battery.report({ charge: 0.41, charging: false });

    expect(screen.getByText("41%")).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const battery = heldBattery();
    const { unmount } = render(
      <Battery domicile={NO_HOST} watch={battery.watch} />,
    );

    unmount();

    expect(battery.stopped).toBe(1);
  });

  describe("the charge running out", () => {
    it("turns the readout to danger at a tenth left", () => {
      const battery = heldBattery();
      const { container } = render(
        <Battery domicile={NO_HOST} watch={battery.watch} />,
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
        <Battery domicile={NO_HOST} watch={battery.watch} />,
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
      // A tenth and a bit reads as `10%`, and a readout that said ten and
      // looked comfortable would be two answers to one question.
      const battery = heldBattery();
      const { container } = render(
        <Battery domicile={NO_HOST} watch={battery.watch} />,
      );

      battery.report({ charge: 0.104, charging: false });

      expect(screen.getByText("10%")).toBeVisible();
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("goes on saying so with the lead in", () => {
      // The bolt says the lead is in. What the colour is about is the cell,
      // and a machine that cannot be unplugged is not a machine that is fine.
      const battery = heldBattery();
      const { container } = render(
        <Battery domicile={NO_HOST} watch={battery.watch} />,
      );

      battery.report({ charge: 0.04, charging: true });

      expect(readout(container).className).toContain(css({ color: "danger" }));
      expect(readout(container).className).toContain(
        css({ animationName: "chargeFlashing" }),
      );
    });
  });
});
