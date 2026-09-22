// `window.domicile`, in TypeScript.
//
// The engine's own contract is the WebIDL in
// `packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
// This file mirrors it and adds nothing: every member below exists there, with
// the same name, and nothing here invents one. When the two disagree the IDL
// wins, because it is what the browser actually built.
//
// **Two spellings, one object.** `window.domicile` is what a shell writes —
// system state is reached at `window.domicile.<interface>`, with nothing to
// register and no singleton to construct — and `navigator.domicile` is where
// it used to live and still does. The fork's `WindowDomicile::domicile`
// forwards to `NavigatorDomicile`, so a window has exactly one host and a
// listener bound through either spelling is bound to the one channel. Both are
// declared below because a shell author gets completion on whichever it types.
//
// Declared here rather than taken from `lib.dom.d.ts` because it is not a web
// standard and never will be — it exists on Domicile's fork, on documents
// served over `domicile://`, and nowhere else. The property is declared
// *optional* for the same reason `HTMLCanvasElement.embedExternalSurface`
// is in `app-element.ts`: every use then has to answer what happens without
// it, which on a stock browser is every use. `connect-to-host.ts` is where the
// SDK answers it once.
//
// # This is a typed surface, not a message pipe
//
// There is no JSON here, no socket, and no handshake. A shell calls methods
// and listens for events; the wire protocol lives in the browser process,
// which is what makes a malformed message unconstructable from a page. The
// cost, which is real, is that adding a message means an engine release rather
// than editing a TypeScript file.
//
// # Units
//
// Every size and coordinate a *method* takes or an *event* carries is a
// logical CSS pixel, and a `double`, because it comes from a layout box and a
// CSS pixel is fractional. {@link DomicileDisplay} is the one exception and is
// documented on its own account.
//
// Keycodes are Linux evdev codes, in both directions — `keycode` rather than
// `key` because `KeyboardEvent.key` already means a string ("Enter").

import type { CursorShape } from "./cursor-shape";

/**
 * A key combination the desktop claims for itself, and the same shape the
 * press comes back as.
 *
 * Written once and compared against the press with the same field names: see
 * {@link DomicileShortcutEvent}, which exposes exactly these fields flat.
 *
 * The modifiers keep the web's names rather than xkb's masks, so a shell that
 * already reads `event.ctrlKey` reads this the same way. They are optional
 * here and default to `false` in the engine's dictionary — a combination is
 * the modifiers it names and no others, so an omitted one is a modifier that
 * must *not* be held rather than one that does not matter.
 */
export type DomicileShortcut = {
  /** An evdev code. Zero is not a key and the engine refuses it. */
  keycode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

/**
 * One screen of the desktop.
 *
 * **Integers, unlike every other size on this surface.** Those come from a
 * layout box, where a CSS pixel is fractional; a display comes from the
 * desktop's configuration, which names whole ones.
 */
export type DomicileDisplay = {
  /**
   * What a shell names this screen: the compositor's own name for it, from the
   * config — `left`, `right` — or `domicile-0` when Domicile is following a
   * window rather than driving displays.
   */
  readonly name: string;
  /**
   * The top-left corner, in the desktop's coordinate space, whose origin is
   * the top-left of the displays' bounding box. Signed: the config may put a
   * display anywhere, and a screen left of the origin has a negative `x`.
   */
  readonly x: number;
  readonly y: number;
  /**
   * Logical — the CSS pixels a shell lays out in, the same units everything
   * else here is in. NOT the `wl_output` mode, which is this times `scale`.
   */
  readonly width: number;
  readonly height: number;
  /**
   * The scale advertised to *clients* on this screen: what a window drawn on
   * it renders at. **Not the shell's own `devicePixelRatio`** — the shell is
   * one page at one density however many screens it spans — so multiplying the
   * sizes above by this gives a client's buffer, not anything to lay out with.
   */
  readonly scale: number;
  /**
   * The pixels the panel scans out, un-turned — the one geometry here that is
   * not logical.
   *
   * **Not a second spelling of `width`/`height`.** A monitor on its side scans
   * out exactly as it did lying down, so a portrait 4K panel is a 3840×2160
   * mode and an 1800×3200 box. Neither follows from the other: `scale` is the
   * integer `wl_output` one, so 1800 times 2 is not 2160.
   *
   * Zero where the compositor said nothing, which is a desktop with no notion
   * of modes rather than a panel with no pixels. Nothing divides by it unless
   * {@link fillsTheWindow} says to.
   */
  readonly modeWidth: number;
  readonly modeHeight: number;
  /**
   * Which way up the monitor is bolted to the desk: `normal`, `rotate-90`,
   * `rotate-180` or `rotate-270`.
   *
   * **Named for the turn the content takes, not the one the panel did** — the
   * `wl_output` convention, which the config file and the host both follow. An
   * output rotated a quarter turn counterclockwise needs what is drawn on it
   * turned a quarter turn *clockwise* to come out upright, and `rotate-90` is
   * that clockwise turn. A shell applies it as written.
   */
  readonly transform: string;
  /**
   * This screen is the whole page, so the page has to fill it: the mode above
   * is the window's own size in CSS pixels, and the logical box has to be
   * turned and scaled to cover it.
   *
   * True where the engine scans out — one window per CRTC, each told the
   * single display it covers. False for every desktop the page's window is the
   * whole of, where the page's CSS pixels already are the desktop's logical
   * ones and there is nothing to map.
   */
  readonly fillsTheWindow: boolean;
};

/**
 * Something happened to a window: it appeared, resized or closed — and, with
 * only `appId` filled in, focus moved to it or was asked for by it.
 *
 * One type for the five because they carry the same thing (which window) and
 * differ only in what else they carry. The fields a given type does not carry
 * are the empty string rather than absent, which is WebIDL's `DOMString` and
 * not a choice the SDK gets to make; `host-message.ts` is where each event
 * becomes a payload with only the fields that event means.
 *
 * A cursor is not one of them. {@link DomicileAppCursorEvent} carries that,
 * because `DomicileCursorShape` is a closed set and a closed set has no
 * spelling for "this event is not about a cursor".
 */
export type DomicileAppEvent = Event & {
  /** The id an `<app>` element names. Empty on `focuschanged` means the chrome. */
  readonly appId: string;
  readonly title: string;
  /**
   * False until the client has committed a buffer.
   *
   * A toplevel maps before it draws, and how big a Wayland client wants to be
   * is something it says by drawing — so a window that has *appeared* may not
   * yet have a size. A shell that reads `width`/`height` while this is false
   * opens the window at nothing at all, which is what happened when the size
   * was zero-when-absent rather than absent.
   */
  readonly hasSize: boolean;
  readonly width: number;
  readonly height: number;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds.
   *
   * **Not `timeStamp`**, which is when the event object was *constructed* — in
   * the renderer, at dispatch — so a shell pricing the IPC against it measures
   * a few microseconds of Blink and calls it the hop. The difference between
   * the two is the stage: the compositor's line read off a socket in the
   * browser process, turned into a mojo message, carried into this renderer
   * and dispatched here.
   *
   * `shortcut` is the one event whose stamp is not a socket read — a chord the
   * shell claimed is matched in the browser process and never reaches the
   * compositor — but it is the same quantity on the same clock: when that
   * process had it.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * A client asked for a cursor to be shown over its window.
 *
 * Its own type rather than a {@link DomicileAppEvent}, and that is the engine's
 * shape rather than the SDK's: `cursor` is a WebIDL `DomicileCursorShape`, a
 * closed set with no member meaning "not a cursor event", so the five events
 * that have nothing to say about a cursor cannot carry the attribute at all.
 * While it was a `DOMString` they carried `""` and a shell had to know that
 * `""` was not a shape.
 */
export type DomicileAppCursorEvent = Event & {
  readonly appId: string;

  /**
   * The CSS `cursor` keyword the client asked for.
   *
   * Typed as the closed set because the engine's bindings now hold it to one:
   * `domicile_cursor_shape.idl` is the same list, and a value outside it
   * cannot cross the bindings in either direction. `host-message.ts` parses it
   * anyway — the DOM is a boundary, and this SDK is versioned apart from the
   * engine it runs against, so the parse is what makes a shell built against a
   * newer list than the engine ships a throw rather than an arrow where a hand
   * should be.
   */
  readonly cursor: CursorShape;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds.
   *
   * **Not `timeStamp`**, which is when the event object was *constructed* — in
   * the renderer, at dispatch — so a shell pricing the IPC against it measures
   * a few microseconds of Blink and calls it the hop. The difference between
   * the two is the stage: the compositor's line read off a socket in the
   * browser process, turned into a mojo message, carried into this renderer
   * and dispatched here.
   *
   * `shortcut` is the one event whose stamp is not a socket read — a chord the
   * shell claimed is matched in the browser process and never reaches the
   * compositor — but it is the same quantity on the same clock: when that
   * process had it.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * A window's title changed.
 *
 * Its own type rather than a {@link DomicileAppEvent}: a client sends
 * `set_title` after creating the toplevel the announcement was for, so the
 * name arrives on its own and again each time it changes.
 */
export type DomicileAppTitledEvent = Event & {
  readonly appId: string;
  readonly title: string;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds.
   *
   * **Not `timeStamp`**, which is when the event object was *constructed* — in
   * the renderer, at dispatch — so a shell pricing the IPC against it measures
   * a few microseconds of Blink and calls it the hop. The difference between
   * the two is the stage: the compositor's line read off a socket in the
   * browser process, turned into a mojo message, carried into this renderer
   * and dispatched here.
   *
   * `shortcut` is the one event whose stamp is not a socket read — a chord the
   * shell claimed is matched in the browser process and never reaches the
   * compositor — but it is the same quantity on the same clock: when that
   * process had it.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * A combination claimed with `grabShortcut()` was pressed.
 *
 * Presses only. A release changes nothing and would arrive as a second event
 * for one keystroke.
 */
export type DomicileShortcutEvent = Event & {
  readonly keycode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds.
   *
   * **Not `timeStamp`**, which is when the event object was *constructed* — in
   * the renderer, at dispatch — so a shell pricing the IPC against it measures
   * a few microseconds of Blink and calls it the hop. The difference between
   * the two is the stage: the compositor's line read off a socket in the
   * browser process, turned into a mojo message, carried into this renderer
   * and dispatched here.
   *
   * `shortcut` is the one event whose stamp is not a socket read — a chord the
   * shell claimed is matched in the browser process and never reaches the
   * compositor — but it is the same quantity on the same clock: when that
   * process had it.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Which modifiers the seat holds. One seat, outliving every window.
 *
 * The compositor has already resolved xkb's depressed/latched/locked against
 * the keymap; a mask would hand the page a number it cannot read without the
 * keymap too.
 */
export type DomicileModifiersEvent = Event & {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds.
   *
   * **Not `timeStamp`**, which is when the event object was *constructed* — in
   * the renderer, at dispatch — so a shell pricing the IPC against it measures
   * a few microseconds of Blink and calls it the hop. The difference between
   * the two is the stage: the compositor's line read off a socket in the
   * browser process, turned into a mojo message, carried into this renderer
   * and dispatched here.
   *
   * `shortcut` is the one event whose stamp is not a socket read — a chord the
   * shell claimed is matched in the browser process and never reaches the
   * compositor — but it is the same quantity on the same clock: when that
   * process had it.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * What there is to open, answering {@link DomicileHost.listFiles}.
 *
 * Paths relative to the home directory the desktop is running as — sorted,
 * and the order is the answer rather than whatever a `read_dir` handed back.
 * An empty list is a home with nothing to offer; a home that could not be read
 * is no event at all, because "you have no files" is not something a broken
 * desktop should be able to say.
 */
export type DomicileFilesEvent = Event & {
  readonly files: readonly string[];

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The machine's battery, pushed whenever the reading moves far enough to draw.
 *
 * **Not what `navigator.getBattery` would tell you**, and that is why this
 * exists. The Battery Status API reads UPower over D-Bus; a desktop on a bare
 * tty has neither, so the engine resolves with Chromium's default
 * `BatteryStatus` — charging, and full — which is a plausible reading and so
 * indistinguishable from the truth from inside a page. The compositor reads
 * `/sys/class/power_supply` instead, which is in every kernel and wants no
 * daemon.
 *
 * There is no `listBattery()` to go with it. A charge changes on its own,
 * where a home directory changes for reasons nothing is watching, so this is
 * pushed and `files` is answered. A machine with no battery sends nothing.
 */
export type DomicileBatteryEvent = Event & {
  /** How full, 0 through 1. */
  readonly charge: number;

  /** Whether a lead is in. A full battery on AC is `true`. */
  readonly charging: boolean;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/** Every event `window.domicile` fires, and what each one carries. */
export type DomicileHostEventMap = {
  appappeared: DomicileAppEvent;
  appresized: DomicileAppEvent;
  appclosed: DomicileAppEvent;
  appcursor: DomicileAppCursorEvent;
  focuschanged: DomicileAppEvent;
  /**
   * A client asked for the keyboard, and nothing has moved: the shell answers
   * with `focusApp()` or lets it stand. See `focus_requested` in
   * `domicile-protocol`.
   */
  focusrequested: DomicileAppEvent;
  apptitled: DomicileAppTitledEvent;
  shortcut: DomicileShortcutEvent;
  modifiers: DomicileModifiersEvent;
  /** The answer to a {@link DomicileHost.listFiles}, and only ever to one. */
  files: DomicileFilesEvent;
  /** The charge, whenever it moves far enough to draw. Nobody asked for it. */
  battery: DomicileBatteryEvent;
  /**
   * The desktop changed: a screen arrived or left, a display was resized, or
   * its density moved. Bare — read {@link DomicileHost.displays} for what it
   * is now.
   */
  displayschanged: Event;
};

/**
 * The shell's control channel to the compositor.
 *
 * It **is** an `EventTarget` — a `DomicileHost : EventTarget` in the IDL — and
 * that is load-bearing rather than incidental: the *first* `addEventListener`
 * binds the mojo channel, and binding is what hands the compositor its way
 * back. Nothing can be dispatched before something has listened.
 *
 * It is not typed as one here, though. Written `EventTarget & { … }` the
 * narrowed `addEventListener` below becomes a second overload behind
 * `lib.dom`'s, and a listener written for a `DomicileAppEvent` gets
 * contextually typed as a plain `Event` by whichever arm TypeScript tries
 * first — so every use would need a cast to read `appId`, which is exactly the
 * thing a typed surface exists to remove. Declaring only what the SDK calls
 * keeps the events typed, and the members `EventTarget` would add
 * (`removeEventListener`, `dispatchEvent`) are ones the SDK has no business
 * calling on the host anyway: a page must never listen on `window.domicile`
 * directly — see `domicile-client.ts` — and nothing in a page dispatches to it.
 *
 * The practical consequence, worth knowing before writing a double: an
 * `EventTarget` does not satisfy this type. `lib.dom` types its callback as
 * `EventListener | EventListenerObject | null`, and a listener that takes a
 * `DomicileAppEvent` is assignable to that in neither direction — the union has
 * a non-function member and a `null` in it. So a stand-in for the host
 * registers listeners its own way rather than inheriting them, which is what
 * `connect-to-host.ts` and the test doubles both do.
 */
export type DomicileHost = {
  /**
   * Run a command on the machine running the desktop.
   *
   * An argv array rather than a single string: splitting a command line is a
   * shell's job and there is no shell in this path. An empty one throws.
   */
  spawn(command: readonly string[]): void;

  /**
   * Ask what there is to open. Answered with a `files` event.
   *
   * **It takes no path, and that is the security property rather than an
   * oversight.** A shell is served over `domicile://` precisely so that it has
   * an origin without a port, not so that it gets a filesystem; a call that
   * named a directory would be one, and every document the engine serves would
   * have it. What is read is the compositor's to decide — see
   * `domicile_host::files` — and this asks only that it decide.
   *
   * A question rather than a subscription: nothing pushes a `files` event on
   * its own, because a home directory changes for reasons no desktop is
   * watching. A launcher asks each time it opens.
   */
  listFiles(): void;

  /** Which window has the keyboard. `focusChrome()` takes it back to the page. */
  focusApp(appId: string): void;
  focusChrome(): void;

  /**
   * Where the pointer is, in this page's own coordinates — the ones a
   * `PointerEvent` reports as `clientX`/`clientY`.
   *
   * **The one message about input that goes the other way**, and the one the
   * page cannot do for itself: a document can read where the pointer is and
   * cannot put it anywhere. The engine draws the cursor, so the engine is what
   * moves it; on the platform that scans out it is a cursor plane, and where
   * something else owns the pointer — a nested run inside another
   * compositor — nothing moves, because a client cannot warp somebody else's
   * pointer.
   *
   * Goes no further than the browser process, like `grabShortcut`: the
   * compositor neither draws this pointer nor hears about it.
   */
  warpPointer(x: number, y: number): void;

  /**
   * Ask a client to close. Not a kill — the client decides, which is why a
   * window can refuse and show a save dialog instead.
   */
  closeApp(appId: string): void;

  setDesktopSize(width: number, height: number): void;
  /** Throws on anything but a positive ratio: the compositor divides by it. */
  setDevicePixelRatio(ratio: number): void;

  /**
   * Route a key combination to the page rather than to the focused client.
   *
   * The press comes back as a `shortcut` event carrying the same fields, so a
   * shell compares what it grabbed against what fired without parsing a string.
   */
  grabShortcut(shortcut: DomicileShortcut): void;

  key(appId: string, keycode: number, pressed: boolean): void;
  pointerMotion(appId: string, x: number, y: number): void;
  pointerLeave(appId: string): void;
  pointerButton(appId: string, button: number, pressed: boolean): void;
  pointerAxis(
    appId: string,
    dx: number,
    dy: number,
    v120X: number,
    v120Y: number,
  ): void;

  /**
   * The screens of the desktop.
   *
   * An attribute rather than an event payload, because the desktop is a fact
   * and not a stream: a component that mounts long after the description
   * arrived can read it, where an event carrying the only copy is gone once
   * dispatched.
   *
   * **`null` until the compositor has described the desktop**, and an empty
   * array for a desktop with no screens on it — different answers, because
   * nothing at all is what an unknown screen renders and that is right for
   * "there is no such screen" and wrong for "wait".
   *
   * A different frozen array after every `displayschanged`: the compositor
   * sends the whole desktop each time it changes.
   */
  readonly displays: readonly DomicileDisplay[] | null;

  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void;
};

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface Window {
    /**
     * The compositor behind this page, or absent. **The spelling a shell
     * writes.**
     *
     * The same object as {@link Navigator.domicile} rather than a second host:
     * see the note at the top of this file.
     *
     * Optional *and* nullable, and both cases are real: the property does not
     * exist at all on a stock browser, and the fork's own accessor answers
     * `null` for a document with no frame. `?? ` covers both, which is what
     * `connect-to-host.ts` does once so nothing else has to.
     */
    readonly domicile?: DomicileHost | null;
  }

  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging onto a built-in type is what `interface` is for and what a type alias cannot do
  interface Navigator {
    /**
     * The compositor behind this page, or absent. Where it was first hung and
     * where it stays: pages that already read it keep working, and it is the
     * same object {@link Window.domicile} answers with.
     */
    readonly domicile?: DomicileHost | null;
  }
}
