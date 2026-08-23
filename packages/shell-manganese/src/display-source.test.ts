import { describe, expect, it } from "bun:test";
import type { Transport } from "@domicile/chrome-sdk/bridge";
import { BridgeClient } from "@domicile/chrome-sdk/bridge";

import { displaysFrom } from "./display-source";

/**
 * A bridge with a host that never speaks, driven by hand.
 *
 * The adapter reads `displays` and registers on `on`, neither of which needs a
 * socket — so the transport here exists only to hand the bridge messages the
 * test wrote.
 */
class Host implements Transport {
  #deliver: ((text: string) => void) | undefined;

  send(): void {
    // The adapter sends nothing; a chrome's outgoing traffic is not its half.
  }

  onMessage(callback: (text: string) => void): void {
    this.#deliver = callback;
  }

  describes(displays: readonly unknown[]): void {
    this.#deliver?.(JSON.stringify({ displays, type: "displays" }));
  }
}

const LEFT = {
  name: "left",
  position: [0, 0] as const,
  scale: 1,
  size: [1920, 1080] as const,
};
const RIGHT = { ...LEFT, name: "right", position: [1920, 0] as const };

/** A bridge and the host that feeds it. */
const connected = (): [BridgeClient, Host] => {
  const host = new Host();
  return [new BridgeClient(host), host];
};

describe("the desktop a shell lays out against", () => {
  it("reads the bridge when asked, not when built", () => {
    // A snapshot taken at construction would hand a provider that mounts later
    // the desktop as of the moment the source was made, which on a desktop
    // that changed in between is the one that is gone.
    const [client, host] = connected();
    const source = displaysFrom(client);
    expect(source.displays).toBeUndefined();

    host.describes([LEFT]);

    expect(source.displays).toStrictEqual([LEFT]);
  });

  it("passes on every desktop after that", () => {
    const [client, host] = connected();
    const seen: (readonly unknown[])[] = [];
    displaysFrom(client).onDisplays((displays) => {
      seen.push(displays);
    });

    host.describes([LEFT]);
    host.describes([LEFT, RIGHT]);

    expect(seen).toStrictEqual([[LEFT], [LEFT, RIGHT]]);
  });

  it("stops when the teardown runs", () => {
    const [client, host] = connected();
    const seen: unknown[] = [];
    const stop = displaysFrom(client).onDisplays((displays) => {
      seen.push(displays);
    });

    stop();
    host.describes([LEFT]);

    expect(seen).toStrictEqual([]);
  });

  it("does not silence a handler that displaced it", () => {
    // `bridge.on` is a single slot, so a second source over one bridge
    // replaces the first. A teardown that removed whatever it found would
    // then silence the live handler — which is a desktop that stops updating
    // with nothing anywhere to say why.
    const [client, host] = connected();
    const source = displaysFrom(client);
    const seen: unknown[] = [];

    const stopFirst = source.onDisplays(() => {
      throw new Error("the displaced handler was called");
    });
    source.onDisplays((displays) => {
      seen.push(displays);
    });
    stopFirst();

    host.describes([LEFT]);

    expect(seen).toStrictEqual([[LEFT]]);
  });
});
