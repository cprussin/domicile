// The in-page client that talks to the Domicile host.
//
// The host injects a `transport` — an object with `send(text)` and
// `onMessage(cb)` — which in the real compositor is backed by a message pipe
// the engine exposes to the page. The BridgeClient handles the version
// handshake, dispatches host events to handlers, and offers typed senders.

import type { ChromeMessage, Placement } from "./chrome-message";
import {
  focusAppMessage,
  focusChromeMessage,
  helloMessage,
  keyMessage,
  placePortalMessage,
  pointerAxisMessage,
  pointerButtonMessage,
  pointerLeaveMessage,
  pointerMotionMessage,
  removePortalMessage,
  spawnMessage,
} from "./chrome-message";
import type { HostMessageOf, HostMessageType } from "./protocol";
import { PROTOCOL_VERSION, parseHostMessage } from "./protocol";

/** The message pipe the host exposes to the page. */
export type Transport = {
  send: (text: string) => void;
  onMessage: (callback: (text: string) => void) => void;
};

export type BridgeOptions = {
  protocolVersion?: number;
};

type Handler = (message: never) => void;

/**
 * The chrome's half of the host protocol: one handshake, a handler table for
 * host events, and a typed sender per chrome message.
 */
export class BridgeClient {
  readonly protocolVersion: number;

  readonly #transport: Transport;
  readonly #handlers = new Map<HostMessageType, Handler>();
  #welcome:
    | { resolve: (version: number) => void; reject: (error: Error) => void }
    | undefined;

  constructor(
    transport: Transport,
    { protocolVersion = PROTOCOL_VERSION }: BridgeOptions = {},
  ) {
    this.protocolVersion = protocolVersion;
    this.#transport = transport;
    this.#transport.onMessage((text) => {
      this.#handleIncoming(text);
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

  pointerAxis(appId: string, dx: number, dy: number): void {
    this.send(pointerAxisMessage(appId, dx, dy));
  }

  key(appId: string, keycode: number, pressed: boolean): void {
    this.send(keyMessage(appId, keycode, pressed));
  }

  // Unknown message types are dropped rather than raised, so a newer host can
  // add messages an older chrome has no handler for. Malformed frames are not
  // in that category: `parseHostMessage` throws on those.
  #handleIncoming(text: string): void {
    const message = parseHostMessage(text);
    if (message !== undefined) {
      if (message.type === "welcome") {
        this.#settleWelcome(message.protocol_version);
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
