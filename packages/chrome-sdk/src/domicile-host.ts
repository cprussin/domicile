// `navigator.domicile`, in TypeScript.
//
// The engine's own contract is the WebIDL in
// `packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
// This file mirrors it and adds nothing: every member below exists there, with
// the same name, and nothing here invents one. When the two disagree the IDL
// wins, because it is what the browser actually built.
//
// Declared here rather than taken from `lib.dom.d.ts` because it is not a web
// standard and never will be — it exists on Domicile's fork, on documents
// served over `domicile://`, and nowhere else. `Navigator.domicile` is
// declared *optional* for the same reason `HTMLCanvasElement.embedExternalSurface`
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

/** Every event `navigator.domicile` fires, and what each one carries. */
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
 * calling on the host anyway: a page must never listen on `navigator.domicile`
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

  /** Which window has the keyboard. `focusChrome()` takes it back to the page. */
  focusApp(appId: string): void;
  focusChrome(): void;

  /**
   * Ask a client to close. Not a kill — the client decides, which is why a
   * window can refuse and show a save dialog instead.
   */
  closeApp(appId: string): void;

  /** The layout box, as a resize. For an `<app>` the box *is* the configure. */
  resizeApp(appId: string, width: number, height: number): void;

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
  interface Navigator {
    /**
     * The compositor behind this page, or absent.
     *
     * Optional *and* nullable, and both cases are real: the property does not
     * exist at all on a stock browser, and the fork's own accessor answers
     * `null` for a document with no frame. `?? ` covers both, which is what
     * `connect-to-host.ts` does once so nothing else has to.
     */
    readonly domicile?: DomicileHost | null;
  }
}
