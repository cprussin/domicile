import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BluetoothGlyph, BluetoothTile } from "./BluetoothQuick";
import { heldActions } from "./held-actions";
import {
  ADAPTER,
  heldBluetooth,
  heldHardware,
  reading,
} from "./held-bluetooth";

/** A host the component never calls, since the library is injected. */
const NO_HOST = new FakeDomicileHost().domicile;

describe(BluetoothGlyph, () => {
  it("shows nothing while no device is connected", () => {
    const bluetooth = heldBluetooth();
    const { container } = render(
      <BluetoothGlyph bluetooth={bluetooth.bluetooth} />,
    );
    bluetooth.report(reading(true, []));
    expect(container).toBeEmptyDOMElement();
  });

  it("names the connected devices", () => {
    const bluetooth = heldBluetooth();
    render(<BluetoothGlyph bluetooth={bluetooth.bluetooth} />);
    bluetooth.report(reading(true, ["WH-1000XM4"], { "WH-1000XM4": 80 }));
    expect(
      screen.getByRole("img", { name: "Bluetooth: WH-1000XM4 (80%)" }),
    ).toBeVisible();
  });

  it("warns when BlueZ fails", () => {
    const bluetooth = heldBluetooth();
    render(<BluetoothGlyph bluetooth={bluetooth.bluetooth} />);
    bluetooth.report(Err({ kind: SystemErrorKind.Dbus, message: "gone" }));
    expect(
      screen.getByRole("img", { name: "Bluetooth unavailable: gone" }),
    ).toBeVisible();
  });
});

describe(BluetoothTile, () => {
  it("shows nothing on a machine without Bluetooth hardware", () => {
    const bluetooth = heldBluetooth();
    const hardware = heldHardware();
    const { container } = render(
      <BluetoothTile
        actions={heldActions().actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={hardware.hardware}
      />,
    );
    hardware.report(Ok(false));
    expect(container).toBeEmptyDOMElement();
  });

  it("names the connected devices, and turns every adapter off", async () => {
    const bluetooth = heldBluetooth();
    const held = heldActions();
    render(
      <BluetoothTile
        actions={held.actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={heldHardware().hardware}
      />,
    );
    bluetooth.report(reading(true, ["WH-1000XM4"]));
    expect(screen.getByText("WH-1000XM4")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Bluetooth" }));

    expect(held.asked).toEqual([["setPowered", ADAPTER, false]]);
  });

  it("opens its details", async () => {
    const bluetooth = heldBluetooth();
    const opened = Promise.withResolvers<true>();
    render(
      <BluetoothTile
        actions={heldActions().actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={heldHardware().hardware}
        onMore={() => {
          opened.resolve(true);
        }}
      />,
    );
    bluetooth.report(reading(false, []));
    expect(screen.getByText("Off")).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Bluetooth details" }),
    );

    expect(await opened.promise).toBe(true);
  });

  it("only shows the state on a locked desktop", () => {
    const bluetooth = heldBluetooth();
    render(
      <BluetoothTile
        actions={heldActions().actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={heldHardware().hardware}
        locked
      />,
    );
    bluetooth.report(reading(true, []));
    expect(screen.getByRole("button", { name: "Bluetooth" })).toBeDisabled();
    expect(screen.getByText("On")).toBeVisible();
  });

  it("says why there is no adapter", () => {
    const bluetooth = heldBluetooth();
    const hardware = heldHardware();
    render(
      <BluetoothTile
        actions={heldActions().actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={hardware.hardware}
      />,
    );
    hardware.report(Ok(true));
    bluetooth.report(Err({ kind: SystemErrorKind.Dbus, message: "gone" }));
    expect(screen.getByRole("button", { name: "Bluetooth" })).toBeDisabled();
    expect(screen.getByText("Unavailable: gone")).toBeVisible();
  });
});
