import { describe, expect, it } from "bun:test";
import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import { PanelKeyboardContext } from "@domicile-desktop/manganese-bar/panel-keyboard";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { QuickSettingsParts } from "./QuickSettings";
import { QuickSettings } from "./QuickSettings";

/** A tile into details, which only shows its state without them. */
const tile =
  (label: string) =>
  ({ onMore }: { onMore?: (() => void) | undefined }) => (
    <QuickTile icon={undefined} label={label} onMore={onMore} />
  );

/** A switch that switches nothing. */
const toggle = (label: string) => () => (
  <QuickToggle
    icon={undefined}
    label={label}
    onPressedChange={() => undefined}
    pressed={false}
  />
);

/** Parts that draw their names, and count the wheel. */
const testParts = () => {
  const wheeled: string[] = [];
  const settings = { opened: 0 };
  const parts: QuickSettingsParts = {
    BatteryStatus: () => <span>Battery 78%</span>,
    BluetoothDetails: () => <p>Bluetooth devices</p>,
    BluetoothTile: tile("Bluetooth"),
    BrightnessRow: () => <span>Brightness slider</span>,
    DarkModeTile: toggle("Dark mode"),
    Indicators: () => <span aria-label="Volume 50%" role="img" />,
    KeepAwakeTile: toggle("Keep awake"),
    NetworkDetails: () => <p>Wi-Fi networks</p>,
    NetworkTile: tile("Wi-Fi"),
    NightLightTile: toggle("Night light"),
    SoundDetails: () => <p>Mixer</p>,
    SoundRow: ({ onMore }) => (
      <button disabled={onMore === undefined} onClick={onMore} type="button">
        Sound details
      </button>
    ),
    useGestures: () => ({
      onAuxClick: () => {
        wheeled.push("middle");
      },
      onWheel: () => {
        wheeled.push("wheel");
      },
    }),
    useOpenSettings: () => () => {
      settings.opened += 1;
    },
  };
  return { parts, settings, wheeled };
};

/** Records whether the panel holds the keyboard. */
const keyboard = () => {
  const held = { now: false };
  return {
    held,
    hold: () => {
      held.now = true;
      return () => {
        held.now = false;
      };
    },
  };
};

const shown = (locked: boolean) => {
  const { parts, settings, wheeled } = testParts();
  const keys = keyboard();
  render(
    <PanelKeyboardContext value={keys.hold}>
      <BarContext value={{ locked, screen: "eDP-1" }}>
        <QuickSettings parts={parts} />
      </BarContext>
    </PanelKeyboardContext>,
  );
  return { keys, settings, wheeled };
};

describe(QuickSettings, () => {
  it("shows the indicators in one button, with the volume gestures", () => {
    const { wheeled } = shown(false);
    const button = screen.getByRole("button", { name: "Quick settings" });
    expect(screen.getByRole("img", { name: "Volume 50%" })).toBeVisible();

    fireEvent.wheel(button, { deltaY: -100 });
    fireEvent(button, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(wheeled).toEqual(["wheel", "middle"]);
  });

  it("opens every tile, the sliders and the battery, holding the keyboard", async () => {
    const { keys } = shown(false);

    await userEvent.click(
      screen.getByRole("button", { name: "Quick settings" }),
    );

    for (const name of [
      "Wi-Fi details",
      "Bluetooth details",
      "Keep awake",
      "Night light",
      "Dark mode",
    ]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getByText("Brightness slider")).toBeVisible();
    expect(screen.getByText("Battery 78%")).toBeVisible();
    expect(keys.held.now).toBe(true);
  });

  it("opens each tile's details in place, and goes back", async () => {
    shown(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Quick settings" }),
    );

    for (const [opener, title, content] of [
      ["Wi-Fi details", "Network", "Wi-Fi networks"],
      ["Bluetooth details", "Bluetooth", "Bluetooth devices"],
      ["Sound details", "Sound", "Mixer"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: opener }));
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
      expect(screen.getByText(content)).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
    }
  });

  it("opens the Settings app from the footer, and closes", async () => {
    const { settings } = shown(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Quick settings" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(settings.opened).toBe(1);
    expect(screen.queryByText("Battery 78%")).toBeNull();
  });

  it("offers only what a locked desktop allows", async () => {
    shown(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Quick settings" }),
    );

    expect(screen.queryByText("Wi-Fi")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep awake" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dark mode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Night light" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Bluetooth details" }),
    ).toBeNull();
    expect(screen.getByText("Bluetooth")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sound details" }),
    ).toBeDisabled();
  });
});
