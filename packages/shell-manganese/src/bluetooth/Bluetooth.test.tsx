import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Bluetooth as Reading } from "@domicile-desktop/system-bluetooth/bluetooth";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { sharedWatch } from "../readouts/shared-watch";
import { Bluetooth } from "./Bluetooth";
import { heldActions } from "./held-actions";

/**
 * A test-controlled BlueZ: `bluetooth` replaces the library's watch, and
 * `report` sends what it would.
 */
const heldBluetooth = () => {
  const listeners: ((bluetooth: Result<Reading, SystemError>) => void)[] = [];
  const watching = { stopped: 0 };
  return {
    bluetooth: sharedWatch(
      (onBluetooth: (bluetooth: Result<Reading, SystemError>) => void) => {
        listeners.push(onBluetooth);
        return () => {
          watching.stopped += 1;
        };
      },
    ),
    report: (bluetooth: Result<Reading, SystemError>) => {
      act(() => {
        for (const onBluetooth of listeners) {
          onBluetooth(bluetooth);
        }
      });
    },
    get stopped() {
      return watching.stopped;
    },
  };
};

/** A host the component never calls, since the library is injected. */
const NO_HOST = new FakeDomicileHost().host;

const ADAPTER = "/org/bluez/hci0";

const reading = (powered: boolean, connected: string[]) =>
  Ok<Reading, SystemError>({
    adapters: [{ discovering: false, path: ADAPTER, powered }],
    devices: [
      ...connected.map((name, index) => ({
        adapter: ADAPTER,
        address: `AC:80:0A:1B:2C:3${index}`,
        battery: undefined,
        connected: true,
        name,
        paired: true,
        path: `${ADAPTER}/dev_${index}`,
      })),
      {
        adapter: ADAPTER,
        address: "F4:73:35:4E:5F:60",
        battery: undefined,
        connected: false,
        name: "MX Master 3",
        paired: true,
        path: `${ADAPTER}/dev_mouse`,
      },
    ],
  });

/** Asks nothing: these tests do not open the panel. */
const NO_ACTIONS = heldActions().actions;

describe("Bluetooth", () => {
  it("shows nothing until BlueZ has answered", () => {
    const bluetooth = heldBluetooth();

    const { container } = render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing without BlueZ or without an adapter", () => {
    const bluetooth = heldBluetooth();
    const { container } = render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
      />,
    );

    bluetooth.report(
      Err({
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.ServiceUnknown",
      }),
    );
    expect(container).toBeEmptyDOMElement();

    bluetooth.report(Ok({ adapters: [], devices: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("says whether it is on, and what is connected", () => {
    const bluetooth = heldBluetooth();
    render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
      />,
    );

    bluetooth.report(reading(false, []));
    expect(screen.getByRole("button", { name: "Bluetooth off" })).toBeVisible();

    bluetooth.report(reading(true, []));
    expect(screen.getByRole("button", { name: "Bluetooth on" })).toBeVisible();

    bluetooth.report(reading(true, ["WH-1000XM4", "MX Master 3"]));
    expect(
      screen.getByRole("button", {
        name: "Bluetooth: WH-1000XM4, MX Master 3",
      }),
    ).toBeVisible();
  });

  it("opens its panel on a click", async () => {
    const bluetooth = heldBluetooth();
    const held = heldActions();
    render(
      <Bluetooth
        actions={held.actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
      />,
    );
    bluetooth.report(reading(true, ["WH-1000XM4"]));

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("switch", { name: "Bluetooth" })).toBeChecked();
    expect(screen.getByText("WH-1000XM4")).toBeVisible();
  });

  it("stops watching when it goes away", () => {
    const bluetooth = heldBluetooth();
    const { unmount } = render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
      />,
    );

    unmount();

    expect(bluetooth.stopped).toBe(1);
  });
});
