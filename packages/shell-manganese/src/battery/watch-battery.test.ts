import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { BatteryMessage } from "@domicile-desktop/sdk/host-message";

import { watchBattery } from "./watch-battery";

/**
 * The client, as much of it as this touches: one slot per message type, and an
 * `off` that removes a handler only if it is still the registered one — which
 * is `DomicileClient`'s own contract and the thing a teardown has to honor.
 */
const heldClient = () => {
  const handlers = new Map<string, (message: BatteryMessage) => void>();
  return {
    client: {
      off: (type: string, handler: (message: BatteryMessage) => void) => {
        if (handlers.get(type) === handler) {
          handlers.delete(type);
        }
      },
      on: (type: string, handler: (message: BatteryMessage) => void) => {
        handlers.set(type, handler);
      },
    } as unknown as DomicileClient,
    says: (reading: BatteryMessage) => {
      handlers.get("battery")?.(reading);
    },
  };
};

describe("watchBattery", () => {
  it("reports every charge the host says", () => {
    const host = heldClient();
    const readings: BatteryMessage[] = [];

    watchBattery(host.client, (reading) => {
      readings.push(reading);
    });
    host.says({ charge: 0.5, charging: false });
    host.says({ charge: 0.49, charging: true });

    expect(readings).toEqual([
      { charge: 0.5, charging: false },
      { charge: 0.49, charging: true },
    ]);
  });

  it("reports to the bar on every monitor, not only the last", () => {
    const host = heldClient();
    const first: BatteryMessage[] = [];
    const second: BatteryMessage[] = [];

    watchBattery(host.client, (reading) => first.push(reading));
    watchBattery(host.client, (reading) => second.push(reading));
    host.says({ charge: 0.5, charging: false });

    expect(first).toEqual([{ charge: 0.5, charging: false }]);
    expect(second).toEqual([{ charge: 0.5, charging: false }]);
  });

  it("stops reporting when it is stopped", () => {
    const host = heldClient();
    const readings: BatteryMessage[] = [];
    const stop = watchBattery(host.client, (reading) => readings.push(reading));

    stop();
    host.says({ charge: 0.5, charging: false });

    expect(readings).toEqual([]);
  });
});
