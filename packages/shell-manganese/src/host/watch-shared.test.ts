import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { BatteryMessage } from "@domicile/sdk/host-message";

import { watchShared } from "./watch-shared";

/**
 * The client, as much of it as this touches: one slot per message type, and an
 * `off` that removes a handler only if it is still the registered one — which
 * is `DomicileClient`'s own contract, and the reason this module exists.
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

const HALF = { charge: 0.5, charging: false };
const LESS = { charge: 0.49, charging: true };

describe("watchShared", () => {
  it("tells every watcher, not only the last one to start", () => {
    const host = heldClient();
    const first: BatteryMessage[] = [];
    const second: BatteryMessage[] = [];

    watchShared(host.client, "battery", (reading) => first.push(reading));
    watchShared(host.client, "battery", (reading) => second.push(reading));
    host.says(HALF);

    expect(first).toEqual([HALF]);
    expect(second).toEqual([HALF]);
  });

  it("tells a watcher that starts late what was last said", () => {
    const host = heldClient();
    const late: BatteryMessage[] = [];

    watchShared(host.client, "battery", () => {
      /* the bar that was there first */
    });
    host.says(HALF);
    watchShared(host.client, "battery", (reading) => late.push(reading));

    expect(late).toEqual([HALF]);
  });

  it("stops telling a watcher that stopped, and only that one", () => {
    const host = heldClient();
    const stopped: BatteryMessage[] = [];
    const kept: BatteryMessage[] = [];

    const stop = watchShared(host.client, "battery", (reading) =>
      stopped.push(reading),
    );
    watchShared(host.client, "battery", (reading) => kept.push(reading));
    stop();
    host.says(LESS);

    expect(stopped).toEqual([]);
    expect(kept).toEqual([LESS]);
  });

  it("keeps hearing the host after every watcher has stopped", () => {
    const host = heldClient();
    const again: BatteryMessage[] = [];

    watchShared(host.client, "battery", () => {
      /* a bar on a monitor that was unplugged */
    })();
    host.says(LESS);
    watchShared(host.client, "battery", (reading) => again.push(reading));

    expect(again).toEqual([LESS]);
  });
});
