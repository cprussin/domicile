import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { render, screen } from "@testing-library/react";
import { css } from "../../styled-system/css";
import { Battery } from "./Battery";
import { heldBattery } from "./held-battery";

/** A host the component never uses, since `watch` is injected. */
const NO_HOST = new FakeDomicileHost().host;

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

    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("shows nothing for a machine without a battery", () => {
    const battery = heldBattery();
    render(<Battery domicile={NO_HOST} watch={battery.watch} />);

    battery.report({ charge: 0.5, charging: false });
    battery.absent();

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
      // 10.4% displays as `10%`, so the color must agree with that.
      const battery = heldBattery();
      const { container } = render(
        <Battery domicile={NO_HOST} watch={battery.watch} />,
      );

      battery.report({ charge: 0.104, charging: false });

      expect(screen.getByText("10%")).toBeVisible();
      expect(readout(container).className).toContain(css({ color: "danger" }));
    });

    it("stops saying so once the lead is in", () => {
      // A charging battery needs no warning.
      const battery = heldBattery();
      const { container } = render(
        <Battery domicile={NO_HOST} watch={battery.watch} />,
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
