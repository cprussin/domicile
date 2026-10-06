import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type {
  DomicileDisplay,
  DomicileHost,
  DomicileHostEventMap,
  DomicileWindow,
} from "@domicile-desktop/sdk/domicile-host";

import { hostDisplays } from "./host-displays";

/** A no-op for every outgoing call to the compositor. */
const ignored = (): undefined => undefined;
/** An ask nobody answers. */
const unanswered = (): Promise<never> => new Promise(() => undefined);

/**
 * A compositor stub that only describes a desktop.
 *
 * The adapter only reads `displays` and listens through `on`, so every other
 * method is a no-op. Written out rather than cast from a partial because
 * `DomicileClient`'s constructor calls `addEventListener`.
 */
class Host implements DomicileHost {
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

  /** Sets the attribute, then fires the event, in the engine's order. */
  describes(displays: readonly DomicileDisplay[]): void {
    this.displays = displays;
    this.#listeners.get("displayschanged")?.(
      new Event("displayschanged") as never,
    );
  }

  // Every outgoing compositor call. The adapter makes none, so they share one
  // no-op.
  readonly activateExtension = ignored;
  readonly closeBrowserWindow = ignored;
  readonly openBrowserWindow = ignored;
  readonly activateTrayItem = ignored;
  readonly dismissNotifications = ignored;
  readonly invokeNotificationAction = ignored;
  readonly closeApp = ignored;
  readonly setAppBounds = ignored;
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
  readonly previewFile = unanswered;
  readonly moveAudioStream = ignored;
  readonly searchFiles = unanswered;
  readonly searchApps = unanswered;
  readonly callSystem = ignored;
  readonly setAudioMuted = ignored;
  readonly setAudioPort = ignored;
  readonly setAudioProfile = ignored;
  readonly setAudioVolume = ignored;
  readonly setBrightness = ignored;
  readonly setDefaultAudioDevice = ignored;
  readonly watchAudioLevels = ignored;
  readonly setTheme = ignored;
  readonly themeCaptured = ignored;
  readonly spawn = ignored;
  readonly unlock = ignored;
  readonly warpPointer = ignored;
}

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

/** The same screen, as `<Screen>` expects it. */
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

/** A client and the compositor stub behind it. */
const connected = (): [DomicileClient, Host] => {
  const host = new Host();
  return [new DomicileClient(host), host];
};

describe("the desktop a shell lays out against", () => {
  it("is regrouped into the rectangle the layout wants", () => {
    // Both shapes use the same logical CSS pixels. The engine uses four numbers
    // (WebIDL has no tuples) and `<Screen>` uses two pairs; regrouping them is
    // this module's job.
    const [client, host] = connected();

    host.describes([LEFT]);

    expect(hostDisplays(client).displays).toStrictEqual([LEFT_LAID_OUT]);
  });

  it("reads the domicile when asked, not when built", () => {
    // A snapshot at construction would give a later-mounted provider a stale
    // desktop.
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
    // `DomicileClient.on` is a single slot, so a second source replaces the
    // first. Removing whatever handler is registered on teardown would silence
    // the live one, and the desktop would stop updating.
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
