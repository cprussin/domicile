// The in-page client for `navigator.domicile`.
//
// The engine gives a shell's document a typed control channel: a `DomicileHost`
// that is an `EventTarget` with methods on it. There is no JSON here, no
// socket, and no handshake — a page calls `host.spawn([...])` and listens for
// `appappeared`, and the wire protocol lives in the browser process where a
// page cannot construct a malformed message.
//
// So what is this class for, if the host is already typed?
//
// # It listens so the page does not have to, and that is the whole point
//
// **A DOM event dispatched with no listener registered is gone.** An
// `EventTarget` has no mailbox: `dispatchEvent` walks the listeners that exist
// at that moment and returns. A React shell registers its handlers in its
// first effect flush — tens of milliseconds after the compositor has started
// talking, and *always* after, because rendering only schedules the effect.
// What lands in that window is one `appappeared` per client already running,
// which is to say a live, drawing client with no window on screen and no
// second announcement coming.
//
// So the bridge registers its own listener for every event type in its
// constructor, and {@link BridgeClient.on} is a registration against *this*
// class rather than against the host. Anything that arrived before the page
// asked for it is held (see {@link BridgeClient.#held}) and delivered when it
// does. That is what `#held` was always for; what changed is that the gap it
// covers is now between the page's handlers and the bridge's own, inside one
// process, rather than between a page and a socket.
//
// **A page must therefore never call `addEventListener` on
// `navigator.domicile` itself.** Not because it would fail — it would work,
// and it would work for everything dispatched after the listener existed,
// which is the subset that makes the bug invisible on a desktop with no
// clients open.
//
// # Nothing can arrive before the bridge is listening
//
// The channel binds on first use, and as of the engine's control-channel
// change that includes the first `addEventListener` — `DomicileHost::
// AddedEventListener` calls `EnsureBound`. Binding is what hands the
// compositor its way back into the page: until the channel is bound there is
// no client end for the browser process to push on, so there is nothing that
// could be dispatched and dropped. The constructor below registers before it
// returns, so by the time anything holds a `BridgeClient` the ordering is
// already safe. A socket the page has not opened cannot deliver either, and
// this is the same guarantee one process further in.
//
// # It translates, because WebIDL's shapes are not a shell's
//
// `hasSize` beside the numbers it guards, a `DOMString` that is empty rather
// than absent, one event class doing five jobs: those are what the IDL can
// say. `host-message.ts` is what a shell wants instead, and it owns the
// translation as well as the names — the listeners below are one call each.
// The translators live there rather than inline here because a decision made
// inside a DOM listener cannot be asserted on: a throw in one is reported to
// the page's error handler rather than raised to whatever dispatched, so the
// cursor keyword the engine does not check would have no test at all.

import type {
  DomicileDisplay,
  DomicileHost,
  DomicileShortcut,
} from "./domicile-host";
import type { HostMessageOf, HostMessageType } from "./host-message";
import {
  appAppeared,
  appClosed,
  appCursor,
  appResized,
  appTitled,
  focusChanged,
  modifiers,
  shortcut,
} from "./host-message";
import { RoundTripWindow } from "./round-trip";
import { SampleWindow } from "./sample-window";
import type { AxisDelta } from "./wheel-axis";

/** The clock the round-trip timing reads; a parameter so tests can hold it. */
const monotonicNow = (): number => performance.now();

export type BridgeOptions = {
  now?: typeof monotonicNow;
};

type Handler = (message: never) => void;

/**
 * The chrome's half of the control channel: a handler table for what the
 * compositor says, and a typed call per thing the chrome asks of it.
 */
export class BridgeClient {
  /**
   * How long keystrokes are taking to become pixels.
   *
   * **This no longer measures anything, and that is a gap rather than a
   * tidy-up.** The bridge used to see both ends of the loop: it sent the key
   * and it drew the frame that answered. A client's buffer now goes to the
   * display compositor and the page embeds the surface, so the far end of the
   * loop does not pass through here at all — `keyed` is still called and
   * `drew` never is, so every report is empty.
   *
   * It is kept, empty, rather than deleted because it is the instrument for
   * the one requirement this whole fork is answerable to: that the compositor
   * add no latency a user can see. Deleting it would leave nothing measuring
   * that and no sign that anything used to. The measurement has to be rebuilt
   * where both ends are now visible — the compositor, which sends the key and
   * holds the engine connection that knows when viz presented.
   */
  readonly roundTrip = new RoundTripWindow();

  /**
   * What the compositor's bytes cost between arriving in this process and
   * reaching this page.
   *
   * **Also empty, and for a different reason than {@link roundTrip}: the thing
   * it measures is still happening, and the instrument is gone.** The hop is
   * as real as it ever was — the compositor's JSON is read in the browser
   * process, becomes a mojo message, crosses to the renderer and is dispatched
   * as a DOM event — and it is the stage that was Electron's IPC at 79ms a
   * frame, which is why it was ever reported separately from a total that
   * would have hidden it.
   *
   * What is gone is the stamp. The old transport was handed the moment the
   * host's own bytes arrived, because whoever read the socket ran in this
   * process and could take it. Nothing on `navigator.domicile` carries an
   * equivalent: not the events, which have no arrival member, and not
   * `Event.timeStamp`, which is when the event was *constructed* — in the
   * renderer, at dispatch — so pricing against it would report a few
   * microseconds of Blink and call it the IPC. An always-zero number is worse
   * than an empty one, because a reader believes it.
   *
   * **The engine member that would fix this does not exist.** A
   * `DOMHighResTimeStamp` on the events saying when the browser process took
   * the message off the compositor's socket is one field on the mojo struct
   * and one attribute on the event classes; until it is there this stays
   * empty, and `diagnostic-lines` renders an empty window as no line rather
   * than as a zero.
   */
  readonly hop = new SampleWindow();

  readonly #host: DomicileHost;
  readonly #handlers = new Map<HostMessageType, Handler>();

  /**
   * Messages that arrived before the page registered a handler for their type,
   * kept in arrival order and delivered when it does.
   *
   * The compositor starts talking the moment the channel binds — one
   * `app_appeared` for every client already running — but a React page
   * registers its handlers in its first effect flush, tens of milliseconds
   * later. Not a race it usually wins: rendering only *schedules* the effect,
   * so the binding precedes every `on` on every startup. Dropping what lands
   * in between is a live, drawing client with no window on screen, and there
   * is no second chance this page can count on: a window is announced once.
   *
   * Unbounded on purpose, and bounded in time by {@link #released}: what can
   * pile up here is only a type the page does register — the constructor
   * listens for exactly the types this build knows — and only before it has
   * registered it, which it does for all of them in one mount.
   */
  readonly #held = new Map<HostMessageType, unknown[]>();
  /**
   * The types the page has listened for and stopped listening for.
   *
   * {@link #held} exists for the gap before a page has *ever* listened. An
   * {@link off} says it listened and chose to stop, so holding for it again
   * would pile up with nothing to drain it.
   *
   * The cost is that what arrives between an {@link off} and a later
   * {@link on} is gone. Fine for anything the page can read back — the desktop
   * is an attribute on the host, so a provider that unmounts and remounts
   * still reads the current one off {@link displays} — and not fine for a
   * lifecycle event, which arrives once on this page's account: `app_appeared`
   * does not come again, so a page that lets go of it and takes it up again
   * has missed whatever mapped in between. Let go of a type only where the
   * page can recover the state some other way.
   */
  readonly #released = new Set<HostMessageType>();
  readonly #now: typeof monotonicNow;

  constructor(host: DomicileHost, { now = monotonicNow }: BridgeOptions = {}) {
    this.#now = now;
    this.#host = host;

    // One listener per event type, registered here rather than left to the
    // page — see this file's head for why that is the whole point of the
    // class, and why registering them all before the constructor returns is
    // what makes the ordering safe.
    host.addEventListener("appappeared", (event) => {
      this.#deliver("app_appeared", appAppeared(event));
    });
    host.addEventListener("apptitled", (event) => {
      this.#deliver("app_titled", appTitled(event));
    });
    host.addEventListener("appresized", (event) => {
      this.#deliver("app_resized", appResized(event));
    });
    host.addEventListener("appclosed", (event) => {
      this.#deliver("app_closed", appClosed(event));
    });
    host.addEventListener("appcursor", (event) => {
      this.#deliver("app_cursor", appCursor(event));
    });
    host.addEventListener("focuschanged", (event) => {
      this.#deliver("focus_changed", focusChanged(event));
    });
    host.addEventListener("shortcut", (event) => {
      this.#deliver("shortcut", shortcut(event));
    });
    host.addEventListener("modifiers", (event) => {
      this.#deliver("modifiers", modifiers(event));
    });
    host.addEventListener("displayschanged", () => {
      // The event is bare and the desktop is on the attribute, which the
      // engine writes before it dispatches — so reading it here is reading
      // *this* description rather than the one before it. Read at dispatch and
      // not at delivery: a description that waits in the hold is replayed with
      // the desktop as of when it fired, and since the last one held carries
      // the latest, a handler processing them in order still ends on the
      // desktop that is there now.
      this.#deliver("displays", { displays: this.#host.displays });
    });
  }

  /**
   * The displays the compositor described, or `undefined` until it has.
   *
   * Read through to the host rather than retained here. The desktop is a fact
   * and not a stream: it lives on `navigator.domicile.displays`, where a
   * component that mounts long after the description reads the same answer as
   * one that was there for it, and where a second reader cannot take it from
   * the first.
   *
   * **Empty reads as `undefined`, and that is a translation the IDL forces.**
   * `displays` is a `FrozenArray` that starts empty, so the engine has one
   * value for "the compositor has not described the desktop yet" and for "a
   * desktop of no screens" — and a shell has to tell them apart, because a
   * `<Screen>` renders nothing for a display nobody mentioned and that is the
   * right answer for one and the wrong one for the other. What makes the
   * collapse safe is the compositor's own invariant, stated in the IDL beside
   * the attribute: it describes at least one output, and the
   * window-following case is a display named `domicile-0` rather than an
   * absence. So an empty list is only ever the first of the two.
   *
   * Units are the display's own: logical CSS pixels for the geometry, and a
   * `scale` that is what *clients* on that screen draw at — not this page's
   * `devicePixelRatio`, which is one number for a shell however many screens
   * it spans.
   */
  get displays(): readonly DomicileDisplay[] | undefined {
    const described = this.#host.displays;
    return described.length === 0 ? undefined : described;
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
    // Deleted before the handler runs, not after: a handler that asks the host
    // for something the compositor answers with the same type would otherwise
    // find the hold still full and see its own messages again.
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

  /**
   * Tell the compositor what resolution to configure this client at.
   *
   * A pair here and two arguments on the host, because a box is one value to a
   * shell and WebIDL has no tuple. Fractional on purpose: this comes from a
   * layout box and a CSS pixel is fractional, so the whole path is `double` —
   * reading it as an integer is what opened every window at zero.
   */
  resizeApp(
    appId: string,
    size: readonly [width: number, height: number],
  ): void {
    this.#host.resizeApp(appId, size[0], size[1]);
  }

  /** Tell the compositor the display density it should advertise to clients. */
  setDevicePixelRatio(ratio: number): void {
    this.#host.setDevicePixelRatio(ratio);
  }

  /**
   * Tell the compositor how big the desktop is, in CSS pixels.
   *
   * The chrome's window *is* the desktop, and under an engine whose window the
   * compositor does not own this is the only way it can learn the size.
   */
  setDesktopSize(size: readonly [width: number, height: number]): void {
    this.#host.setDesktopSize(size[0], size[1]);
  }

  focusApp(appId: string): void {
    this.#host.focusApp(appId);
  }

  focusChrome(): void {
    this.#host.focusChrome();
  }

  /**
   * Ask the client owning `appId` to close its window.
   *
   * A request, not a kill: a terminal exits, an editor with unsaved work puts
   * a dialog up and stays. The window goes when `app_closed` arrives.
   */
  closeApp(appId: string): void {
    this.#host.closeApp(appId);
  }

  /** Ask the compositor to spawn a client process (argv array). */
  spawn(command: readonly string[]): void {
    this.#host.spawn(command);
  }

  /**
   * Claim a key combination for the desktop, whatever holds the keyboard.
   *
   * The press arrives back as a `shortcut` message rather than as a DOM event,
   * because the page is not what received it — and it carries the same fields
   * this was given, so a shell compares the two without parsing a string.
   */
  grabShortcut(shortcut: DomicileShortcut): void {
    this.#host.grabShortcut(shortcut);
  }

  // ---- input forwarding ---------------------------------------------------

  pointerMotion(appId: string, x: number, y: number): void {
    this.#host.pointerMotion(appId, x, y);
  }

  pointerLeave(appId: string): void {
    this.#host.pointerLeave(appId);
  }

  pointerButton(appId: string, button: number, pressed: boolean): void {
    this.#host.pointerButton(appId, button, pressed);
  }

  pointerAxis(appId: string, { dx, dy, v120X, v120Y }: AxisDelta): void {
    this.#host.pointerAxis(appId, dx, dy, v120X, v120Y);
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
    this.#host.key(appId, keycode, pressed);
  }

  /**
   * Hand a message to its handler, or hold it until one registers.
   *
   * A {@link #released} type has neither: nobody is listening and that is
   * deliberate, so it is dropped rather than kept for a handler that may never
   * come.
   */
  #deliver<T extends HostMessageType>(
    type: T,
    message: HostMessageOf<T>,
  ): void {
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
}
