import { beforeEach, describe, expect, it } from "bun:test";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { hostTheme } from "./host-theme";
import { rememberedTheme } from "./remembered-theme";

/**
 * A host, and the compositor behind it: what it states, and what it was asked
 * for.
 */
const connected = () => {
  const fake = new FakeDomicileHost();
  const called = (method: string) =>
    fake.calls.filter(([name]) => name === method).map(([, theme]) => theme);
  return [
    fake.host,
    {
      get asked() {
        return called("setTheme");
      },
      get captured() {
        return called("themeCaptured");
      },
      /** The compositor saying which way round the desk is drawn. */
      states: (theme: Theme) => {
        fake.set({ theme });
      },
      /** The compositor saying which way round the desk's windows are drawn. */
      turnsItsWindows: (theme: Theme) => {
        fake.set({ windowsTheme: theme });
      },
    },
  ] as const;
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
    // be the shell changing while every window stayed as it was.
    const [client, host] = connected();

    hostTheme(client).setTheme("light");

    expect(host.asked).toStrictEqual(["light"]);
  });

  it("is remembered, so the next load of this page paints in it", () => {
    // The theme is the desk's and is never stored as a setting. What is
    // stored is a guess for the milliseconds before the handshake lands.
    const [client, host] = connected();
    hostTheme(client).onTheme(() => undefined);

    host.states("light");

    expect(rememberedTheme()).toBe("light");
  });

  it("is the desk's own once it has stated one, before any provider", () => {
    const [client, host] = connected();
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

describe("the windows a shell's wipe passes across", () => {
  it("are turned by telling the desk the old frame is held", () => {
    const [client, host] = connected();

    hostTheme(client)
      .turnWindows("light")
      .catch(() => undefined);

    expect(host.captured).toStrictEqual(["light"]);
  });

  it("have turned once the desk says so, and not before", async () => {
    // What the wipe holds its old frame for: a wipe that started sooner
    // would reveal windows still drawn the old way, and they would pop over
    // behind it.
    const [client, host] = connected();
    // The handshake states the windows' theme too, and a shell has said
    // hello long before anybody clicks: that one is not an answer.
    host.turnsItsWindows("dark");
    const turning = hostTheme(client).turnWindows("light");

    expect(
      await Promise.race([
        turning.then(() => "turned"),
        new Promise((resolve) => {
          setTimeout(resolve, 50, "held");
        }),
      ]),
    ).toBe("held");

    host.turnsItsWindows("light");
    await turning;
  });
});
