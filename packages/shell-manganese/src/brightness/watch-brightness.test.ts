import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { BrightnessMessage } from "@domicile/chrome-sdk/host-message";

import { watchBrightness } from "./watch-brightness";

/** The client, as much of it as this touches — see `watch-battery.test.ts`. */
const heldClient = () => {
  const handlers = new Map<string, (message: BrightnessMessage) => void>();
  return {
    client: {
      off: (type: string, handler: (message: BrightnessMessage) => void) => {
        if (handlers.get(type) === handler) {
          handlers.delete(type);
        }
      },
      on: (type: string, handler: (message: BrightnessMessage) => void) => {
        handlers.set(type, handler);
      },
    } as unknown as DomicileClient,
    says: (level: number) => {
      handlers.get("brightness")?.({ level });
    },
    get watching() {
      return handlers.has("brightness");
    },
  };
};

describe("watchBrightness", () => {
  it("reports every level the host says", () => {
    const host = heldClient();
    const levels: number[] = [];

    watchBrightness(host.client, (level) => {
      levels.push(level);
    });
    host.says(0.5);
    host.says(0.42);

    expect(levels).toEqual([0.5, 0.42]);
  });

  it("stops listening when it is stopped", () => {
    const host = heldClient();
    const stop = watchBrightness(host.client, () => {
      /* nothing to record */
    });

    stop();

    expect(host.watching).toBe(false);
  });
});
