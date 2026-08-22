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
  closeAppMessage,
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
import type { DisplayInfo, HostMessageOf, HostMessageType } from "./protocol";
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

  /**
   * Messages that arrived before the page registered a handler for their type,
   * kept in arrival order and delivered when it does.
   *
   * The host starts talking the moment the socket opens — the `welcome`, and
   * one `app_appeared` for every client already running — but a React page
   * registers its handlers in its first effect flush, tens of milliseconds
   * later. Not a race it usually wins: rendering only *schedules* the effect,
   * so `hello` precedes every `on` on every startup. Dropping what lands in
   * between is a live, drawing client with no window on screen, and there is
   * no second chance — nothing ever re-sends `app_appeared` for it.
   *
   * Unbounded on purpose, and bounded in time by {@link #released}: what can
   * pile up here is only a type the page does register — {@link
   * parseHostMessage} has already dropped the ones it does not know — and only
   * before it has registered it, which it does for all of them in one mount.
   */
  readonly #held = new Map<HostMessageType, unknown[]>();
  /**
   * The types the page has listened for and stopped listening for.
   *
   * {@link #held} exists for the gap before a page has *ever* listened. An
   * {@link off} says it listened and chose to stop, so holding for it again
   * would pile up with nothing to drain it — for `app_frame`, a buffer the
   * size of the screen every frame.
   *
   * The cost is that what arrives between an {@link off} and a later
   * {@link on} is gone. Fine for anything the page can read back — `displays`
   * is retained on {@link displays}, so a provider that unmounts and remounts
   * still sees the current desktop — and not fine for a lifecycle event, which
   * is announced once: nothing re-sends `app_appeared`, so a page that lets go
   * of it and takes it up again has missed whatever mapped in between. Let go
   * of a type only where the page can recover the state some other way.
   */
  readonly #released = new Set<HostMessageType>();
  readonly #now: typeof monotonicNow;
  #welcome: ((agreed: Result<number, HandshakeFailure>) => void) | undefined;
  #displays: readonly DisplayInfo[] | undefined;

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
   * The displays the host described, or `undefined` until it has.
   *
   * Retained rather than only delivered, because {@link #held} answers the
   * *first* handler to register for a type and then forgets — which is right
   * for a stream and wrong for a fact. `displays` arrives once per connection,
   * so a page whose components each register their own handler would leave
   * every one after the first with nothing, and silently: a component with no
   * displays renders the same empty region as one for a display that is not
   * there.
   *
   * `undefined` is "not told yet" and `[]` is "told, and the desktop is the
   * one that follows Domicile's own window". A shell that collapsed the two
   * would lay out against a screen whose shape it had not been given.
   *
   * This fixes the replay half of that problem and not the other half:
   * {@link on} is a single-slot registry, so a second `on("displays")` still
   * *unregisters* the first for every message after it. Anything wanting to
   * react to a change — as opposed to reading the current desktop — has to
   * register once and fan out from there.
   */
  get displays(): readonly DisplayInfo[] | undefined {
    return this.#displays;
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

  /**
   * Register the handler for a host message `type` (e.g. `app_appeared`).
   *
   * Anything of that type that arrived before this call is delivered to
   * `handler` synchronously, in the order it arrived — see {@link #held}.
   */
  on<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    this.#handlers.set(type, handler as Handler);
    const waiting = this.#held.get(type);
    // Deleted before the handler runs, not after: a handler that sends
    // something the host answers with the same type would otherwise find the
    // hold still full and see its own messages again.
    this.#held.delete(type);
    for (const message of waiting ?? []) {
      handler(message as HostMessageOf<T>);
    }
    return this;
  }

  /**
   * Stop delivering `type` to `handler`.
   *
   * Only if `handler` is still the one registered. {@link on} is a single
   * slot, so a later registration has already displaced an earlier one — and a
   * teardown that removed whatever it found would then silence the live
   * handler on behalf of the dead one. Which caller does that is not this
   * class's business to predict: it takes the handler rather than the type
   * alone so that letting one go is safe in any order, the way `off` on an
   * event target is.
   *
   * Nothing is held for this type again — see {@link #released}. The hold is
   * for the gap before a page has ever listened, and this says it listened and
   * stopped. There is nothing to clear: {@link on} empties the hold as it
   * registers, so by the time this runs it is already empty.
   */
  off<T extends HostMessageType>(
    type: T,
    handler: (message: HostMessageOf<T>) => void,
  ): this {
    if (this.#handlers.get(type) === handler) {
      this.#handlers.delete(type);
      this.#released.add(type);
    }
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

  /**
   * Ask the client owning `appId` to close its window.
   *
   * A request, not a kill: a terminal exits, an editor with unsaved work puts
   * a dialog up and stays. The window goes when `app_closed` arrives.
   */
  closeApp(appId: string): void {
    this.send(closeAppMessage(appId));
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
  // add messages an older chrome cannot name. A *known* type with no handler
  // yet is a different thing and is held, not dropped — see `#held`. Malformed
  // frames are in neither category: `parseHostMessage` throws on those.
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
        this.#deliver(message.type, { ...message, pixels });
        // After the handler, not before: the handler is what puts the pixels
        // on the canvas, and `putImageData` for a full window is a real cost —
        // measuring before it would leave the most suspect step out.
        this.roundTrip.drew(message.app_id, this.#now());
      } else {
        if (message.type === "displays") {
          // Kept before it is delivered, so a handler that reads the accessor
          // sees this message rather than the one before it.
          this.#displays = message.displays;
        }
        this.#deliver(message.type, message);
      }
    }
  }

  /**
   * Hand a message to its handler, or hold it until one registers.
   *
   * A {@link #released} type has neither: nobody is listening and that is
   * deliberate, so it is dropped rather than kept for a handler that may never
   * come.
   */
  #deliver(type: HostMessageType, message: unknown): void {
    const handler = this.#handlers.get(type);
    if (handler !== undefined) {
      handler(message as never);
    } else if (!this.#released.has(type)) {
      const waiting = this.#held.get(type);
      if (waiting === undefined) {
        this.#held.set(type, [message]);
      } else {
        waiting.push(message);
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
