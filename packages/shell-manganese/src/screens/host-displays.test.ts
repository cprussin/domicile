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
  readonly copyClipboardEntry = ignored;
  readonly focusApp = ignored;
  readonly focusChrome = ignored;
  readonly grabShortcut = ignored;
  readonly listFiles = ignored;
  readonly key = ignored;
  readonly pointerAxis = ignored;
  readonly pointerButton = ignored;
  readonly pointerLeave = ignored;
  readonly pointerMotion = ignored;
  readonly setDesktopSize = ignored;
  readonly setDevicePixelRatio = ignored;
  readonly setTheme = ignored;
  readonly spawn = ignored;
  readonly warpPointer = ignored;
}

/**
 * One screen, as the engine describes it: a monitor of a desktop the page's
 * window is the whole of, so nothing claims it is a window of its own.
 */
const LEFT: DomicileDisplay = {
  fillsTheWindow: false,
  height: 1080,
  modeHeight: 1080,
  modeWidth: 1920,
  name: "left",
  scale: 1,
  transform: "normal",
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
  scanout: undefined,
  size: [1920, 1080],
};
const RIGHT_LAID_OUT: Display = {
  ...LEFT_LAID_OUT,
  name: "right",
  position: [1920, 0],
};

/**
 * A 4K panel on its side at density 1.2, whose window is itself: what the
 * engine sends for every monitor when it is scanning out.
 */
const SIDEWAYS: DomicileDisplay = {
  fillsTheWindow: true,
  height: 3200,
  modeHeight: 2160,
  modeWidth: 3840,
  name: "drm-3",
  scale: 2,
  transform: "rotate-270",
  width: 1800,
  x: 0,
  y: 0,
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

  it("hands on a window to cover where the engine says this screen is one", () => {
    // The tty case, and the one place the two shapes differ rather than
    // regroup. The engine states the mode, the turn and the flag as three
    // flat fields because WebIDL has no nullable dictionary attribute;
    // `<Screen>` wants the one thing they add up to, which is a window to
    // cover or nothing at all.
    const [client, host] = connected();

    host.describes([SIDEWAYS]);

    expect(hostDisplays(client).displays).toStrictEqual([
      {
        name: "drm-3",
        position: [0, 0],
        scale: 2,
        scanout: { size: [3840, 2160], transform: "rotate-270" },
        size: [1800, 3200],
      },
    ]);
  });

  it("drops a mode nothing claimed was a window", () => {
    // A desktop the page's window is the whole of still carries a mode and a
    // turn -- they are facts about the panel -- and a region that took them
    // for an instruction would scale a nested run by the density and draw it
    // off its own window. The flag is what says which, and it is read here so
    // that a region never has to.
    const [client, host] = connected();

    host.describes([{ ...SIDEWAYS, fillsTheWindow: false }]);

    expect(hostDisplays(client).displays?.[0]?.scanout).toBeUndefined();
  });

  it("reads a turn it does not know as none at all", () => {
    // The engine hands the name over as a `DOMString` rather than a WebIDL
    // enum, so the set is closed on both sides of it and open in the middle.
    // `normal` rather than a refusal, because this is one field of a whole
    // desktop: discarding it would cost the shell every screen rather than
    // one monitor's rotation.
    const [client, host] = connected();

    host.describes([{ ...SIDEWAYS, transform: "rotate270" }]);

    expect(hostDisplays(client).displays?.[0]?.scanout?.transform).toBe(
      "normal",
    );
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
