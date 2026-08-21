// The in-page client that talks to the Domicile host.
//
// The host injects a `transport` — an object with `send(text)` and
// `onMessage(cb)` — which in the real compositor is backed by a message pipe
// the engine exposes to the page. The BridgeClient handles the version
// handshake, dispatches host events to handlers, and offers typed senders.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

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
import { SampleWindow } from "./sample-window";
import type { AxisDelta } from "./wheel-axis";

/** The clock the round-trip timing reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

/**
 * Why a handshake did not agree.
 *
 * A value rather than a rejection because the two halves disagreeing is a
 * contract outcome, not a bug: the handshake crosses a process boundary, and
 * what the host answers with is part of what `connect` is for. Rejecting put
 * it in the throw channel, where a caller has to remember it exists. See
 * docs/guidelines/OPTION_RESULT.md.
 *
 * One variant so far. It is a constructor rather than a bare object because a
 * second is already foreseeable — a host that closes the socket without ever
 * answering — and the enum is what makes adding it one edit.
 */
export enum HandshakeFailureKind {
  VersionMismatch,
}

export const HandshakeFailure = {
  VersionMismatch: ({ chrome, host }: { chrome: number; host: number }) => ({
    chrome,
    host,
    kind: HandshakeFailureKind.VersionMismatch as const,
  }),
};

export type HandshakeFailure = ReturnType<
  (typeof HandshakeFailure)[keyof typeof HandshakeFailure]
>;

/** What a failed handshake reads as on a console. */
export const describeHandshakeFailure = (failure: HandshakeFailure): string => {
  switch (failure.kind) {
    case HandshakeFailureKind.VersionMismatch: {
      return `protocol version mismatch: chrome speaks ${failure.chrome.toString()}, host speaks ${failure.host.toString()}`;
    }
  }
};

/** The message pipe the host exposes to the page. */
export type Transport = {
  send: (text: string) => void;
  onMessage: (
    callback: (
      text: string,
      pixels?: Uint8Array<ArrayBuffer>,
      /**
       * When the host's own bytes arrived, on the same clock `now` reads.
       * Optional because a transport that is not a socket — the no-op one the
       * shell falls back to in a plain browser — has no such moment.
       */
      sentAt?: number,
    ) => void,
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

  /**
   * What the host's bytes cost between arriving in this process and reaching
   * this page. Zero work of the page's own is inside it: the stamp is taken by
   * whoever read the socket, and this is the first line of the page to run.
   */
  readonly hop = new SampleWindow();

  readonly #transport: Transport;
  readonly #handlers = new Map<HostMessageType, Handler>();
  readonly #now: typeof monotonicNow;
  #welcome: ((agreed: Result<number, HandshakeFailure>) => void) | undefined;

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
    this.#transport.onMessage((text, pixels, sentAt) => {
      if (sentAt !== undefined) {
        this.hop.record(this.#now() - sentAt);
      }
      this.#handleIncoming(text, pixels);
    });
  }

  /**
   * Perform the handshake.
   *
   * @returns The agreed protocol version, or why the two halves did not
   *   agree. A `Result` rather than a rejection: a host speaking another
   *   version is part of this call's contract rather than a bug in it, so it
   *   belongs in the type where the caller has to answer for it.
   */
  connect(): Promise<Result<number, HandshakeFailure>> {
    const promise = new Promise<Result<number, HandshakeFailure>>((settle) => {
      this.#welcome = settle;
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
    const mismatch = HandshakeFailure.VersionMismatch({
      chrome: this.protocolVersion,
      host: hostVersion,
    });
    this.#welcome?.(
      hostVersion === this.protocolVersion ? Ok(hostVersion) : Err(mismatch),
    );
  }
}
