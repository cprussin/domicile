import { describe, expect, it, spyOn } from "bun:test";
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
    adapters: [{ path: ADAPTER, powered }],
    connected: connected.map((name, index) => ({
      name,
      path: `${ADAPTER}/dev_${index}`,
    })),
  });

/** Never called: the test does not click. */
const NO_POWER = () => {
  throw new Error("test: nothing should turn Bluetooth on or off");
};

describe("Bluetooth", () => {
  it("shows nothing until BlueZ has answered", () => {
    const bluetooth = heldBluetooth();

    const { container } = render(
      <Bluetooth
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        power={NO_POWER}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing without BlueZ or without an adapter", () => {
    const bluetooth = heldBluetooth();
    const { container } = render(
      <Bluetooth
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        power={NO_POWER}
      />,
    );

    bluetooth.report(
      Err({
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.ServiceUnknown",
      }),
    );
    expect(container).toBeEmptyDOMElement();

    bluetooth.report(Ok({ adapters: [], connected: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("says whether it is on, and what is connected", () => {
    const bluetooth = heldBluetooth();
    render(
      <Bluetooth
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        power={NO_POWER}
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

  describe("a click", () => {
    it("turns every adapter off when one is on", async () => {
      const bluetooth = heldBluetooth();
      const asked = new Promise<[string, boolean]>((resolve) => {
        render(
          <Bluetooth
            bluetooth={bluetooth.bluetooth}
            domicile={NO_HOST}
            power={(_system, adapter, powered) => {
              resolve([adapter, powered]);
              return Promise.resolve(Ok("set"));
            }}
          />,
        );
      });
      bluetooth.report(reading(true, []));

      await userEvent.click(screen.getByRole("button"));

      expect(await asked).toStrictEqual([ADAPTER, false]);
    });

    it("turns them on when all are off", async () => {
      const bluetooth = heldBluetooth();
      const asked = new Promise<[string, boolean]>((resolve) => {
        render(
          <Bluetooth
            bluetooth={bluetooth.bluetooth}
            domicile={NO_HOST}
            power={(_system, adapter, powered) => {
              resolve([adapter, powered]);
              return Promise.resolve(Ok("set"));
            }}
          />,
        );
      });
      bluetooth.report(reading(false, []));

      await userEvent.click(screen.getByRole("button"));

      expect(await asked).toStrictEqual([ADAPTER, true]);
    });

    it("logs BlueZ's refusal", async () => {
      const blocked: SystemError = {
        kind: SystemErrorKind.Dbus,
        message: "org.bluez.Error.Blocked: Blocked through rfkill",
      };
      const logged = new Promise<unknown[]>((resolve) => {
        spyOn(console, "error").mockImplementationOnce((...args) => {
          resolve(args);
        });
      });
      const bluetooth = heldBluetooth();
      render(
        <Bluetooth
          bluetooth={bluetooth.bluetooth}
          domicile={NO_HOST}
          power={() => Promise.resolve(Err(blocked))}
        />,
      );
      bluetooth.report(reading(false, []));

      await userEvent.click(screen.getByRole("button"));

      expect(await logged).toStrictEqual([
        "Failed to turn Bluetooth on",
        blocked,
      ]);
    });
  });

  it("stops watching when it goes away", () => {
    const bluetooth = heldBluetooth();
    const { unmount } = render(
      <Bluetooth
        bluetooth={bluetooth.bluetooth}
        domicile={NO_HOST}
        power={NO_POWER}
      />,
    );

    unmount();

    expect(bluetooth.stopped).toBe(1);
  });
});
