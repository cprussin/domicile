// The in-page client that talks to the Domicile host.
//
// The host injects a `transport` — an object with `send(text)` and
// `onMessage(cb)` — which in the real compositor is backed by a message pipe
// the engine exposes to the page. The BridgeClient handles the version
// handshake, dispatches host events to handlers, and offers typed senders.

import {
  helloMessage,
  placePortalMessage,
  removePortalMessage,
  focusAppMessage,
  focusChromeMessage,
  spawnMessage,
  pointerMotionMessage,
  pointerLeaveMessage,
  pointerButtonMessage,
  pointerAxisMessage,
  keyMessage,
  PROTOCOL_VERSION,
} from "./placement.js";

export class BridgeClient {
  /**
   * @param {{send: (text: string) => void, onMessage: (cb: (text: string) => void) => void}} transport
   * @param {{protocolVersion?: number}} [opts]
   */
  constructor(transport, { protocolVersion = PROTOCOL_VERSION } = {}) {
    this.transport = transport;
    this.protocolVersion = protocolVersion;
    this._handlers = new Map();
    this._welcomeResolve = null;
    this._welcomeReject = null;
    this.transport.onMessage((text) => this._handleIncoming(text));
  }

  /** Perform the handshake. Resolves with the agreed version, rejects on mismatch. */
  connect() {
    const promise = new Promise((resolve, reject) => {
      this._welcomeResolve = resolve;
      this._welcomeReject = reject;
    });
    this.send(helloMessage(this.protocolVersion));
    return promise;
  }

  /** Register a handler for a host message `type` (e.g. "app_appeared"). */
  on(type, handler) {
    this._handlers.set(type, handler);
    return this;
  }

  send(message) {
    this.transport.send(JSON.stringify(message));
  }

  placePortal(placement) {
    this.send(placePortalMessage(placement));
  }

  removePortal(appId) {
    this.send(removePortalMessage(appId));
  }

  focusApp(appId) {
    this.send(focusAppMessage(appId));
  }

  focusChrome() {
    this.send(focusChromeMessage());
  }

  /** Ask the compositor to spawn a client process (argv array). */
  spawn(command) {
    this.send(spawnMessage(command));
  }

  // ---- input forwarding ---------------------------------------------------

  pointerMotion(appId, x, y) {
    this.send(pointerMotionMessage(appId, x, y));
  }
  pointerLeave(appId) {
    this.send(pointerLeaveMessage(appId));
  }
  pointerButton(appId, button, pressed) {
    this.send(pointerButtonMessage(appId, button, pressed));
  }
  pointerAxis(appId, dx, dy) {
    this.send(pointerAxisMessage(appId, dx, dy));
  }
  key(appId, keycode, pressed) {
    this.send(keyMessage(appId, keycode, pressed));
  }

  _handleIncoming(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return; // ignore malformed frames rather than crashing the chrome
    }

    if (message.type === "welcome") {
      if (message.protocol_version === this.protocolVersion) {
        this._welcomeResolve?.(message.protocol_version);
      } else {
        this._welcomeReject?.(
          new Error(
            `protocol version mismatch: chrome speaks ${this.protocolVersion}, host speaks ${message.protocol_version}`,
          ),
        );
      }
      return;
    }

    const handler = this._handlers.get(message.type);
    if (handler) handler(message);
    // Unknown types are ignored so a newer host can add messages safely.
  }
}
