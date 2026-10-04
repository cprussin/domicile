import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import type { DomicileDisplay } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { hostDisplays } from "./host-displays";

/** One screen, as the engine describes it. */
const LEFT: DomicileDisplay = {
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
  size: [1920, 1080],
};
const RIGHT_LAID_OUT: Display = {
  ...LEFT_LAID_OUT,
  name: "right",
  position: [1920, 0],
};

/** A host, and the compositor that describes desktops to it. */
const connected = () => {
  const fake = new FakeDomicileHost();
  return [
    fake.host,
    {
      describes: (displays: readonly DomicileDisplay[]) => {
        fake.set({ displays });
      },
    },
  ] as const;
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

  it("lets go of its own handler and no other", () => {
    // A page draws a provider per source, and a teardown that silenced every
    // listener would be a desktop that stops updating with nothing anywhere
    // to say why.
    const [client, host] = connected();
    const source = hostDisplays(client);
    const seen: unknown[] = [];

    const stopFirst = source.onDisplays(() => {
      throw new Error("the stopped handler was called");
    });
    source.onDisplays((displays) => {
      seen.push(displays);
    });
    stopFirst();

    host.describes([LEFT]);

    expect(seen).toStrictEqual([[LEFT_LAID_OUT]]);
  });
});
