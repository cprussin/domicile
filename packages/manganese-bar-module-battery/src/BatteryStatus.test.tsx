import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { BatteryStatus } from "./BatteryStatus";
import { heldBattery } from "./held-battery";

/** What the status says for `reading`. */
const said = (
  reading: Parameters<ReturnType<typeof heldBattery>["report"]>[0],
) => {
  const battery = heldBattery();
  const { container } = render(<BatteryStatus battery={battery.battery} />);
  battery.report(reading);
  return container.textContent;
};

describe(BatteryStatus, () => {
  it("says nothing until there is a battery", () => {
    const battery = heldBattery();
    const { container } = render(<BatteryStatus battery={battery.battery} />);
    battery.absent();
    expect(container).toBeEmptyDOMElement();
  });

  it("says the charge and how long it lasts", () => {
    expect(said({ charge: 0.78, charging: false, secondsLeft: 12_000 })).toBe(
      "Battery 78%, about 3 h 20 min left",
    );
  });

  it("says minutes alone under an hour", () => {
    expect(said({ charge: 0.4, charging: false, secondsLeft: 1500 })).toBe(
      "Battery 40%, about 25 min left",
    );
  });

  it("says the charge alone without an estimate", () => {
    expect(said({ charge: 0.4, charging: false })).toBe("Battery 40%");
  });

  it("says when it is plugged in", () => {
    expect(said({ charge: 0.4, charging: true })).toBe(
      "Battery 40%, plugged in",
    );
  });

  it("warns when low", () => {
    said({ charge: 0.08, charging: false, secondsLeft: 1200 });
    expect(
      screen.getByText("Battery low: 8%, about 20 min left"),
    ).toBeInTheDocument();
  });
});
