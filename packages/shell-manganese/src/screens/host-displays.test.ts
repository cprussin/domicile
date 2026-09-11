import { describe, expect, it } from "bun:test";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type {
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
} from "@domicile/chrome-sdk/domicile-host";
import type { Display } from "@domicile/component-library/display-source";

import { hostDisplays } from "./host-displays";

/** What every call *out* to the compositor does here, which is nothing. */
const ignored = (): undefined => undefined;

/**
 * A compositor that only ever describes a desktop.
 *
 * The adapter reads `displays` and registers through `on`, and neither of those
 * is a call *out* — so every method here is a no-op and only the attribute and
 * the one event do anything. Written out rather than cast from a partial,
 * because `DomicileClient` registers a listener for every event type in its
 * constructor and a double missing `addEventListener` would throw there.
 */
class Host implements DomicileHost {
  displays: readonly DomicileDisplay[] | null = null;

  readonly #listeners = new Map<string, (event: never) => void>();

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void {
    this.#listeners.set(type, listener);
  }

  /** The attribute, and then the bare event — the engine's own order. */
  describes(displays: readonly DomicileDisplay[]): void {
    this.displays = displays;
    this.#listeners.get("displayschanged")?.(
      new Event("displayschanged") as never,
    );
  }

  // Everything the chrome can ask a compositor for. None of it is this
  // module's half — the adapter only ever reads and listens — so they are one
  // shared no-op rather than fourteen empty bodies.
  readonly closeApp = ignored;
  readonly focusApp = ignored;
  readonly focusChrome = ignored;
  readonly grabShortcut = ignored;
  readonly key = ignored;
  readonly pointerAxis = ignored;
  readonly pointerButton = ignored;
  readonly pointerLeave = ignored;
  readonly pointerMotion = ignored;
  readonly resizeApp = ignored;
  readonly setDesktopSize = ignored;
  readonly setDevicePixelRatio = ignored;
  readonly spawn = ignored;
}

/** One screen, as the engine describes it. */
const LEFT: DomicileDisplay = {
  height: 1080,
  name: "left",
  scale: 1,
  width: 1920,
  x: 0,
  y: 0,
};
const RIGHT: DomicileDisplay = { ...LEFT, name: "right", x: 1920 };

/** The same screen, as `<Screen>` lays out against it. */
const LEFT_LAID_OUT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};
const RIGHT_LAID_OUT: Display = {
  ...LEFT_LAID_OUT,
  name: "right",
  position: [1920, 0],
};

/** A domicile client and the compositor that describes desktops to it. */
const connected = (): [DomicileClient, Host] => {
  const host = new Host();
  return [new DomicileClient(host), host];
};

describe("the desktop a shell lays out against", () => {
  it("is regrouped into the rectangle the layout wants", () => {
    // The two shapes are the same logical CSS pixels in the same desktop-wide
    // space, and nothing is converted — but the engine names the corner and
    // the extent as four numbers, because WebIDL has no tuple, and `<Screen>`
    // positions against a pair and a pair. This module is where that happens,
    // and it is the whole reason it is not a pass-through any more.
    const [client, host] = connected();

    host.describes([LEFT]);

    expect(hostDisplays(client).displays).toStrictEqual([LEFT_LAID_OUT]);
  });

  it("reads the domicile when asked, not when built", () => {
    // A snapshot taken at construction would hand a provider that mounts later
    // the desktop as of the moment the source was made, which on a desktop
    // that changed in between is the one that is gone.
    const [client, host] = connected();
    const source = hostDisplays(client);
    expect(source.displays).toBeUndefined();

    host.describes([LEFT]);

    expect(source.displays).toStrictEqual([LEFT_LAID_OUT]);
  });

  it("passes on every desktop after that", () => {
    const [client, host] = connected();
    const seen: (readonly unknown[])[] = [];
    hostDisplays(client).onDisplays((displays) => {
      seen.push(displays);
    });

    host.describes([LEFT]);
    host.describes([LEFT, RIGHT]);

    expect(seen).toStrictEqual([
      [LEFT_LAID_OUT],
      [LEFT_LAID_OUT, RIGHT_LAID_OUT],
    ]);
  });

  it("stops when the teardown runs", () => {
    const [client, host] = connected();
    const seen: unknown[] = [];
    const stop = hostDisplays(client).onDisplays((displays) => {
      seen.push(displays);
    });

    stop();
    host.describes([LEFT]);

    expect(seen).toStrictEqual([]);
  });

  it("does not silence a handler that displaced it", () => {
    // `DomicileClient.on` is a single slot, so a second source over one client
    // replaces the first. A teardown that removed whatever it found would
    // then silence the live handler — which is a desktop that stops updating
    // with nothing anywhere to say why.
    const [client, host] = connected();
    const source = hostDisplays(client);
    const seen: unknown[] = [];

    const stopFirst = source.onDisplays(() => {
      throw new Error("the displaced handler was called");
    });
    source.onDisplays((displays) => {
      seen.push(displays);
    });
    stopFirst();

    host.describes([LEFT]);

    expect(seen).toStrictEqual([[LEFT_LAID_OUT]]);
  });
});
