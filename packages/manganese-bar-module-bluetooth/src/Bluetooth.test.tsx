import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Bluetooth as Reading } from "@domicile-desktop/system-bluetooth/bluetooth";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { css } from "../styled-system/css";
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

/** A test-controlled check for Bluetooth hardware. */
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

/** A check that never answers, for tests about BlueZ alone. */
const UNCHECKED = heldHardware().hardware;

/** A host the component never calls, since the library is injected. */
const NO_HOST = new FakeDomicileHost().host;

const ADAPTER = "/org/bluez/hci0";

/** `batteries` holds the charge of the connected devices that report one. */
const reading = (
  powered: boolean,
  connected: string[],
  batteries: Record<string, number> = {},
) =>
  Ok<Reading, SystemError>({
    adapters: [{ discovering: false, path: ADAPTER, powered }],
    devices: [
      ...connected.map((name, index) => ({
        adapter: ADAPTER,
        address: `AC:80:0A:1B:2C:3${index}`,
        battery: batteries[name],
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
        hardware={UNCHECKED}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing on a machine without Bluetooth hardware", () => {
    const bluetooth = heldBluetooth();
    const hardware = heldHardware();
    const { container } = render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={hardware.hardware}
      />,
    );

    hardware.report(Ok(false));
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

  describe("with hardware BlueZ cannot use", () => {
    const shown = () => {
      const bluetooth = heldBluetooth();
      const hardware = heldHardware();
      render(
        <Bluetooth
          actions={NO_ACTIONS}
          bluetooth={bluetooth.bluetooth}
          domicile={NO_HOST}
          hardware={hardware.hardware}
        />,
      );
      hardware.report(Ok(true));
      return bluetooth;
    };

    it("shows it reading until BlueZ answers", () => {
      shown();

      expect(
        screen.getByRole("img", { name: "Reading Bluetooth" }),
      ).toBeVisible();
    });

    it("shows it off when rfkill took the adapter away", () => {
      shown().report(Ok({ adapters: [], devices: [] }));

      expect(
        screen.getByRole("img", { name: "Bluetooth off" }).className,
      ).toContain(css({ opacity: "inactive" }));
    });

    it("warns when BlueZ fails", () => {
      shown().report(
        Err({
          kind: SystemErrorKind.Dbus,
          message: "org.freedesktop.DBus.Error.ServiceUnknown",
        }),
      );

      expect(
        screen.getByRole("img", {
          name: "Bluetooth unavailable: org.freedesktop.DBus.Error.ServiceUnknown",
        }).className,
      ).toContain(css({ color: "warning" }));
    });
  });

  it("says whether it is on, dimmed when off, and what is connected", () => {
    const bluetooth = heldBluetooth();
    render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={UNCHECKED}
      />,
    );

    bluetooth.report(reading(false, []));
    expect(
      screen.getByRole("button", { name: "Bluetooth off" }).className,
    ).toContain(css({ "& > svg": { opacity: "inactive" } }));

    bluetooth.report(reading(true, []));
    expect(
      screen.getByRole("button", { name: "Bluetooth on" }).className,
    ).not.toContain(css({ "& > svg": { opacity: "inactive" } }));

    bluetooth.report(reading(true, ["WH-1000XM4", "MX Master 3"]));
    expect(
      screen.getByRole("button", {
        name: "Bluetooth: WH-1000XM4, MX Master 3",
      }),
    ).toBeVisible();
  });

  it("names each connected device's battery, also as its tooltip", () => {
    const bluetooth = heldBluetooth();
    render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={UNCHECKED}
      />,
    );

    bluetooth.report(
      reading(true, ["WH-1000XM4", "MX Master 3"], { "WH-1000XM4": 80 }),
    );

    expect(
      screen.getByRole("button", {
        name: "Bluetooth: WH-1000XM4 (80%), MX Master 3",
      }),
    ).toHaveAttribute("title", "Bluetooth: WH-1000XM4 (80%), MX Master 3");
  });

  it("only shows what is connected on a locked desk", () => {
    // A locked desk refuses power, pairing and connecting.
    const bluetooth = heldBluetooth();
    render(
      <Bluetooth
        actions={NO_ACTIONS}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={UNCHECKED}
        locked
      />,
    );

    bluetooth.report(reading(true, ["WH-1000XM4"], { "WH-1000XM4": 80 }));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Bluetooth: WH-1000XM4 (80%)" }),
    ).toHaveAttribute("title", "Bluetooth: WH-1000XM4 (80%)");

    bluetooth.report(reading(false, []));
    expect(
      screen.getByRole("img", { name: "Bluetooth off" }).className,
    ).toContain(css({ opacity: "inactive" }));
  });

  it("opens its panel on a click", async () => {
    const bluetooth = heldBluetooth();
    const held = heldActions();
    render(
      <Bluetooth
        actions={held.actions}
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        hardware={UNCHECKED}
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
        hardware={UNCHECKED}
      />,
    );

    unmount();

    expect(bluetooth.stopped).toBe(1);
  });
});
