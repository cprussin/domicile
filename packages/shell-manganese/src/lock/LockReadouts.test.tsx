import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { heldBattery } from "../battery/held-battery";
import { heldBacklight } from "../brightness/held-backlight";
import { device, heldSound, laptop } from "../volume/fixture";
import { LockReadouts } from "./LockReadouts";

/** The readouts, on a test-controlled battery, backlight and sound server. */
const readouts = () => {
  const battery = heldBattery();
  const backlight = heldBacklight();
  const sound = heldSound();
  render(
    <LockReadouts
      readouts={{
        audio: sound.audio,
        backlight: backlight.backlight,
        battery: battery.battery,
        sound: sound.server,
      }}
    />,
  );
  return { backlight, battery, sound, user: userEvent.setup() };
};

describe("LockReadouts", () => {
  it("shows the battery, brightness and the default output's volume", () => {
    const { backlight, battery, sound } = readouts();

    battery.report({ charge: 0.8, charging: false });
    backlight.report(0.42);
    sound.report(laptop);

    expect(screen.getByRole("meter", { name: "Battery" })).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("shows only what the desk has", () => {
    const { sound } = readouts();

    sound.report({ ...laptop, outputs: [] });

    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("asks the desk for the brightness the slider is moved to", async () => {
    const { backlight, user } = readouts();
    backlight.report(0.42);

    act(() => {
      screen.getByRole("slider", { name: "Brightness" }).focus();
    });
    await user.keyboard("{ArrowRight}");

    expect(backlight.asked).toEqual([0.43]);
  });

  it("sets and mutes the default output", async () => {
    const { sound, user } = readouts();
    sound.report({
      ...laptop,
      outputs: [
        device({ description: "HDMI", id: "output:hdmi" }),
        device({ default: true, id: "output:speakers", volume: 0.5 }),
      ],
    });

    act(() => {
      screen.getByRole("slider", { name: "Volume" }).focus();
    });
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Mute Volume" }));

    expect(sound.asked).toEqual([
      ["setVolume", "output:speakers", 0.51],
      ["setMuted", "output:speakers", true],
    ]);
  });
});
