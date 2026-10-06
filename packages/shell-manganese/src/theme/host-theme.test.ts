import { beforeEach, describe, expect, it } from "bun:test";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { hostTheme } from "./host-theme";
import { rememberedTheme } from "./remembered-theme";

/** A fake host that sends a theme and records theme requests. */
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
      /** Sends the desktop's theme. */
      states: (theme: Theme) => {
        fake.set({ theme });
      },
      /** Sends the windows' theme. */
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
    // A click only requests the change. The compositor applies it to every
    // chrome and to the settings portal GTK and Qt clients read; applying it
    // locally would change the shell but not the windows.
    const [client, host] = connected();

    hostTheme(client).setTheme("light");

    expect(host.asked).toStrictEqual(["light"]);
  });

  it("is remembered, so the next load of this page paints in it", () => {
    // The remembered guess is written here because this is the only place the
    // theme arrives.
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
    // The wipe holds its old frame until windows repaint; starting sooner would
    // reveal windows still in the old theme.
    const [client, host] = connected();
    // The handshake also sends the windows' theme, long before any click; that
    // one is not an answer.
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
