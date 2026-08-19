// The in-page client that talks to the Domicile host.
//
// The host injects a `transport` — an object with `send(text)` and
// `onMessage(cb)` — which in the real compositor is backed by a message pipe
// the engine exposes to the page. The BridgeClient handles the version
// handshake, dispatches host events to handlers, and offers typed senders.

import type { ChromeMessage, Placement, Shortcut } from "./chrome-message";
import {
  focusAppMessage,
  focusChromeMessage,
  grabShortcutMessage,
  helloMessage,
  keyMessage,
  placePortalMessage,
  pointerAxisMessage,
  pointerButtonMessage,
  pointerLeaveMessage,
  pointerMotionMessage,
  removePortalMessage,
  resizeAppMessage,
  setDevicePixelRatioMessage,
  spawnMessage,
} from "./chrome-message";
import type { HostMessageOf, HostMessageType } from "./protocol";
import { PROTOCOL_VERSION, parseHostMessage } from "./protocol";
import { RoundTripWindow } from "./round-trip";
import type { AxisDelta } from "./wheel-axis";

/** The clock the round-trip timing reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

/** The message pipe the host exposes to the page. */
export type Transport = {
  send: (text: string) => void;
  onMessage: (
    callback: (text: string, pixels?: Uint8Array<ArrayBuffer>) => void,
  ) => void;
};

export type BridgeOptions = {
  protocolVersion?: number;
  now?: typeof monotonicNow;
};

type Handler = (message: never) => void;

/**
 * The chrome's half of the host protocol: one handshake, a handler table for
 * host events, and a typed sender per chrome message.
 */
export class BridgeClient {
  readonly protocolVersion: number;

  /**
   * How long keystrokes are taking to become pixels. The bridge is the only
   * place that sees both ends of that loop, so it is where the measurement is
   * taken; whoever wants to report it reads it from here.
   */
  readonly roundTrip = new RoundTripWindow();

  readonly #transport: Transport;
  readonly #handlers = new Map<HostMessageType, Handler>();
  readonly #now: typeof monotonicNow;
  #welcome:
    | { resolve: (version: number) => void; reject: (error: Error) => void }
    | undefined;

  constructor(
    transport: Transport,
    {
      protocolVersion = PROTOCOL_VERSION,
      now = monotonicNow,
    }: BridgeOptions = {},
  ) {
    this.protocolVersion = protocolVersion;
    this.#now = now;
    this.#transport = transport;
    this.#transport.onMessage((text, pixels) => {
      this.#handleIncoming(text, pixels);
    });
  }

  /**
   * Perform the handshake.
   *
   * @returns The agreed protocol version; rejects when the host speaks a
   *   different one.
   */
  connect(): Promise<number> {
    const promise = new Promise<number>((resolve, reject) => {
      this.#welcome = { reject, resolve };
    });
    this.send(helloMessage(this.protocolVersion));
    return promise;
  }

  /** Register the handler for a host message `type` (e.g. `app_appeared`). */
  on<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    this.#handlers.set(type, handler as Handler);
    return this;
  }

  send(message: ChromeMessage): void {
    this.#transport.send(JSON.stringify(message));
  }

  placePortal(placement: Placement): void {
    this.send(placePortalMessage(placement));
  }

  removePortal(appId: string): void {
    this.send(removePortalMessage(appId));
  }

  resizeApp(
    appId: string,
    size: readonly [width: number, height: number],
  ): void {
    this.send(resizeAppMessage(appId, size));
  }

  /** Tell the host the display density it should advertise to clients. */
  setDevicePixelRatio(ratio: number): void {
    this.send(setDevicePixelRatioMessage(ratio));
  }

  focusApp(appId: string): void {
    this.send(focusAppMessage(appId));
  }

  focusChrome(): void {
    this.send(focusChromeMessage());
  }

  /** Ask the compositor to spawn a client process (argv array). */
  spawn(command: readonly string[]): void {
    this.send(spawnMessage(command));
  }

  /**
   * Claim a key combination for the desktop, whatever holds the keyboard.
   *
   * The press arrives back as a `shortcut` message rather than as a DOM event,
   * because the page is not what received it.
   */
  grabShortcut(shortcut: Shortcut): void {
    this.send(grabShortcutMessage(shortcut));
  }

  // ---- input forwarding ---------------------------------------------------

  pointerMotion(appId: string, x: number, y: number): void {
    this.send(pointerMotionMessage(appId, x, y));
  }

  pointerLeave(appId: string): void {
    this.send(pointerLeaveMessage(appId));
  }

  pointerButton(appId: string, button: number, pressed: boolean): void {
    this.send(pointerButtonMessage(appId, button, pressed));
  }

  pointerAxis(appId: string, delta: AxisDelta): void {
    this.send(pointerAxisMessage(appId, delta));
  }

  key(appId: string, keycode: number, pressed: boolean): void {
    // Presses only. Releasing a key changes nothing on screen, so the next
    // frame to arrive is some unrelated redraw — a terminal's blinking cursor,
    // half a second later — and timing to that reports the blink interval as
    // input latency. Since every press is followed by a release, counting them
    // would contaminate half of every sample.
    if (pressed) {
      this.roundTrip.keyed(appId, this.#now());
    }
    this.send(keyMessage(appId, keycode, pressed));
  }

  // Unknown message types are dropped rather than raised, so a newer host can
  // add messages an older chrome has no handler for. Malformed frames are not
  // in that category: `parseHostMessage` throws on those.
  #handleIncoming(text: string, pixels?: Uint8Array<ArrayBuffer>): void {
    const message = parseHostMessage(text);
    if (message !== undefined) {
      if (message.type === "welcome") {
        this.#settleWelcome(message.protocol_version);
      } else if (message.type === "app_frame") {
        // The pixels never went through JSON, so they are joined to the
        // message here rather than coming out of the schema. A frame header
        // without them is a transport that lost the bytes it promised.
        if (pixels === undefined) {
          throw new Error(
            `app_frame for ${message.app_id} arrived without its ${message.bytes} bytes`,
          );
        }
        this.#handlers.get(message.type)?.({ ...message, pixels } as never);
        // After the handler, not before: the handler is what puts the pixels
        // on the canvas, and `putImageData` for a full window is a real cost —
        // measuring before it would leave the most suspect step out.
        this.roundTrip.drew(message.app_id, this.#now());
      } else {
        this.#handlers.get(message.type)?.(message as never);
      }
    }
  }

  #settleWelcome(hostVersion: number): void {
    if (hostVersion === this.protocolVersion) {
      this.#welcome?.resolve(hostVersion);
    } else {
      this.#welcome?.reject(
        new Error(
          `protocol version mismatch: chrome speaks ${this.protocolVersion.toString()}, host speaks ${hostVersion.toString()}`,
        ),
      );
    }
  }
}
