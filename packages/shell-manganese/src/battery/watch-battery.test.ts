import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { BatteryMessage } from "@domicile/chrome-sdk/host-message";

import { watchBattery } from "./watch-battery";

/**
 * The client, as much of it as this touches: one slot per message type, and an
 * `off` that removes a handler only if it is still the registered one — which
 * is `DomicileClient`'s own contract and the thing a teardown has to honour.
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
    get watching() {
      return handlers.has("battery");
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

  it("stops listening when it is stopped", () => {
    const host = heldClient();
    const stop = watchBattery(host.client, () => {
      /* nothing to record */
    });

    stop();

    expect(host.watching).toBe(false);
  });
});
