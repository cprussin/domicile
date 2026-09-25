import { beforeEach, describe, expect, it } from "bun:test";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type {
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
} from "@domicile/chrome-sdk/domicile-host";
import type { Theme } from "@domicile/component-library/theme-core";

import { hostTheme } from "./host-theme";

/** What every call *out* to the compositor does here, unless it is recorded. */
const ignored = (): undefined => undefined;

/**
 * A compositor that states a theme and remembers being asked for one.
 *
 * Written out rather than cast from a partial, for `host-displays.test.ts`'s
 * reason: `DomicileClient` registers a listener for every event type in its
 * constructor, so a double missing `addEventListener` would throw there.
 */
class Host implements DomicileHost {
  readonly asked: Theme[] = [];
  displays: readonly DomicileDisplay[] | null = null;

  readonly #listeners = new Map<string, (event: never) => void>();

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void {
    this.#listeners.set(type, listener);
  }

  /** The compositor saying which way round the desk is drawn. */
  states(theme: Theme): void {
    this.#listeners.get("theme")?.(
      Object.assign(new Event("theme"), { arrival: 0, theme }) as never,
    );
  }

  setTheme = (theme: Theme): void => {
    this.asked.push(theme);
  };

  readonly closeApp = ignored;
  readonly copyClipboardEntry = ignored;
  readonly focusApp = ignored;
  readonly focusChrome = ignored;
  readonly grabShortcut = ignored;
  readonly key = ignored;
  readonly pointerAxis = ignored;
  readonly pointerButton = ignored;
  readonly pointerLeave = ignored;
  readonly pointerMotion = ignored;
  readonly searchFiles = ignored;
  readonly setDesktopSize = ignored;
  readonly setDevicePixelRatio = ignored;
  readonly spawn = ignored;
  readonly warpPointer = ignored;
}

const connected = (): [DomicileClient, Host] => {
  const host = new Host();
  return [new DomicileClient(host), host];
};

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("the theme a shell paints in", () => {
  it("is what the desk states", async () => {
    const [client, host] = connected();
    const source = hostTheme(client);
    const told = await new Promise<Theme>((resolve) => {
      source.onTheme(resolve);
      host.states("light");
    });

    expect(told).toBe("light");
  });

  it("is asked for rather than applied", () => {
    // THE LOAD-BEARING ONE. A click is a request: the compositor answers to
    // every chrome on the desk, and hands the same value to the settings
    // portal its GTK and Qt clients read. A source that applied it here would
    // be the one monitor that had changed.
    const [client, host] = connected();

    hostTheme(client).setTheme("light");

    expect(host.asked).toStrictEqual(["light"]);
  });

  it("is remembered, so the next load of this page paints in it", () => {
    // The theme is the desk's and is never stored as a setting. What is
    // stored is a guess for the milliseconds before the handshake lands, and
    // this is the one place the desk's theme arrives — `on` is a single slot
    // per message type, so a second registration to do the remembering would
    // displace the provider's.
    const [client, host] = connected();
    hostTheme(client).onTheme(() => undefined);

    host.states("light");

    expect(hostTheme(client).theme).toBe("light");
  });

  it("is nothing at all before this page has ever seen the desk", () => {
    const [client] = connected();
    expect(hostTheme(client).theme).toBeUndefined();
  });

  it("stops being delivered to a provider that let go", () => {
    const [client, host] = connected();
    const told: Theme[] = [];
    const stop = hostTheme(client).onTheme((theme) => {
      told.push(theme);
    });

    stop();
    host.states("light");

    expect(told).toStrictEqual([]);
  });
});
