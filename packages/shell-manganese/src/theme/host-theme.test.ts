import { beforeEach, describe, expect, it } from "bun:test";
import type { Theme } from "@domicile-desktop/component-library/theme-core";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type {
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
  DomicileWindow,
} from "@domicile-desktop/sdk/domicile-host";

import { hostTheme } from "./host-theme";

/** A no-op for every outgoing compositor call that is not recorded. */
const ignored = (): undefined => undefined;

/**
 * A compositor stub that sends a theme and records theme requests.
 *
 * Written out rather than cast from a partial because `DomicileClient`'s
 * constructor calls `addEventListener` (as in `host-displays.test.ts`).
 */
class Host implements DomicileHost {
  readonly asked: Theme[] = [];
  readonly captured: Theme[] = [];
  displays: readonly DomicileDisplay[] | null = null;
  brightness: number | null = null;
  browserWindows = null;
  readonly windows: readonly DomicileWindow[] = [];
  readonly focusedWindow: string | null = null;
  readonly altKey = null;
  readonly audioCards = null;
  readonly audioInputs = null;
  readonly audioOutputs = null;
  readonly audioPlayback = null;
  readonly audioRecording = null;
  readonly batteryCharge = null;
  readonly batteryCharging = null;
  readonly clipboard = null;
  readonly ctrlKey = null;
  readonly extensions = null;
  readonly idle = null;
  readonly locked = null;
  readonly metaKey = null;
  readonly notifications = null;
  readonly shiftKey = null;
  readonly theme = null;
  readonly tray = null;
  readonly windowsTheme = null;

  readonly #listeners = new Map<string, (event: never) => void>();

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void {
    this.#listeners.set(type, listener);
  }

  /** Sends the desktop's theme. */
  states(theme: Theme): void {
    this.#listeners.get("theme")?.(
      Object.assign(new Event("theme"), { arrival: 0, theme }) as never,
    );
  }

  /** Sends the windows' theme. */
  turnsItsWindows(theme: Theme): void {
    this.#listeners.get("windowstheme")?.(
      Object.assign(new Event("windowstheme"), { arrival: 0, theme }) as never,
    );
  }

  setTheme = (theme: Theme): void => {
    this.asked.push(theme);
  };

  themeCaptured = (theme: Theme): void => {
    this.captured.push(theme);
  };

  readonly activateExtension = ignored;
  readonly closeBrowserWindow = ignored;
  readonly openBrowserWindow = ignored;
  readonly activateTrayItem = ignored;
  readonly dismissNotifications = ignored;
  readonly invokeNotificationAction = ignored;
  readonly closeApp = ignored;
  readonly copyClipboardEntry = ignored;
  readonly focusApp = ignored;
  readonly focusChrome = ignored;
  readonly grabShortcut = ignored;
  readonly key = ignored;
  readonly lock = ignored;
  readonly pointerAxis = ignored;
  readonly pointerButton = ignored;
  readonly pointerLeave = ignored;
  readonly pointerMotion = ignored;
  readonly previewFile = ignored;
  readonly moveAudioStream = ignored;
  readonly searchFiles = ignored;
  readonly searchApps = ignored;
  readonly setAudioMuted = ignored;
  readonly setAudioPort = ignored;
  readonly setAudioProfile = ignored;
  readonly setAudioVolume = ignored;
  readonly setBrightness = ignored;
  readonly setDefaultAudioDevice = ignored;
  readonly watchAudioLevels = ignored;
  readonly spawn = ignored;
  readonly unlock = ignored;
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
    // A click only requests the change. The compositor applies it to every
    // chrome and to the settings portal GTK and Qt clients read; applying it
    // locally would change the shell but not the windows.
    const [client, host] = connected();

    hostTheme(client).setTheme("light");

    expect(host.asked).toStrictEqual(["light"]);
  });

  it("is remembered, so the next load of this page paints in it", () => {
    // The remembered guess is written here because this is the only place the
    // theme arrives. `on` is one slot per message type, so a second
    // registration would replace the provider's.
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
