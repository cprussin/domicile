// What `BridgeClient.on` hands a shell, and what it is called.
//
// One layer below this is `navigator.domicile`, whose events are typed but are
// shaped for WebIDL: a `DOMString` that is empty rather than absent, a
// `hasSize` boolean beside the numbers it guards, one event class doing five
// jobs. One layer above it is a shell, which wants the thing that happened and
// only the fields that happened with it. This is the vocabulary in between —
// the names, and the translators that turn one of the engine's events into
// one of them. `bridge.ts` is what calls them, once per listener.
//
// # Why these names and not the IDL's
//
// The keys are the compositor's own names for its messages — `app_appeared`,
// not `appappeared` — because that is what a shell has always written and
// because it is still what the two ends of the protocol call them: the
// compositor sends `app_appeared` over its socket and the browser process
// renames it on the way through. A shell reading a compositor log and a shell
// reading its own source should be reading the same word.
//
// # A map, not a discriminated union
//
// These used to be a zod discriminated union over a `type` field, because they
// arrived as JSON and the tag was in the bytes. Nothing carries a tag now: the
// event type is the DOM event's, and `on` already has it in hand. Keeping a
// `type` field would be the dispatch key written twice, with two chances to
// disagree — so the association lives in {@link HostMessageMap} instead, and a
// payload carries only what its own event means.

import type { CursorShape } from "./cursor-shape";
import { cursorShapeSchema } from "./cursor-shape";
import type {
  DomicileAppEvent,
  DomicileAppTitledEvent,
  DomicileDisplay,
  DomicileModifiersEvent,
  DomicileShortcutEvent,
} from "./domicile-host";

/**
 * A window exists.
 *
 * Not once per client: the compositor replays every window already running to
 * a chrome that has just bound its channel, so a page can be told about a
 * window it already holds — and is expected to ignore that, keying its windows
 * by app id. A chrome that mounts an element per message instead ends up with
 * two for one client, the first of them orphaned.
 */
export type AppAppearedMessage = {
  app_id: string;
  /**
   * Absent until the client has committed a buffer, which it has not when this
   * message goes out: a toplevel maps before it draws, and how big a Wayland
   * client wants to be is something it says by drawing. The size arrives on the
   * `app_resized` that follows. A chrome with none has to decide the window's
   * size itself — believing a number here is what opened windows at nothing at
   * all when the absence was spelled `[0, 0]`.
   */
  size: readonly [width: number, height: number] | undefined;
  title: string | undefined;
};

/**
 * A client named its window, or renamed it.
 *
 * `undefined` is a window with no name, and it is two things at once: a client
 * that has not sent `set_title` yet, and a client that named it *nothing* —
 * `xdg_toplevel.set_title("")`, xdg-shell having no request that takes a name
 * back. Both reach the page as the empty string and both mean the same
 * nothing, so they become one thing here rather than at every place a name is
 * drawn.
 */
export type AppTitledMessage = {
  app_id: string;
  title: string | undefined;
};

export type AppResizedMessage = {
  app_id: string;
  size: readonly [width: number, height: number];
};

export type AppClosedMessage = {
  app_id: string;
};

export type AppCursorMessage = {
  app_id: string;
  cursor: CursorShape;
};

/**
 * Who holds the keyboard now.
 *
 * The chrome asks for focus with `focusApp`, but it is not the only thing that
 * moves it — a click on a window focuses it in the compositor, and a focused
 * client going away hands the keyboard back — so a chrome that tracked only
 * its own requests would be right until the first click and wrong afterwards.
 *
 * `undefined` is the chrome itself, which is an answer a desktop draws
 * differently from any window being active.
 */
export type FocusChangedMessage = {
  app_id: string | undefined;
};

/**
 * A client asked for the keyboard.
 *
 * A question, not news — {@link FocusChangedMessage} is the news, and the
 * shell is what turns one into the other by calling `focusApp`. Ignoring it is
 * a policy, and the one a desktop that will not let a background window
 * interrupt its user has.
 *
 * Never the chrome, so never `undefined`: this comes from a client.
 */
export type FocusRequestedMessage = {
  app_id: string;
};

/**
 * A combination the chrome claimed, pressed.
 *
 * The same shape `grabShortcut` takes — see `DomicileShortcut` — so a shell
 * compares what it grabbed against what fired without parsing a string. Flat
 * rather than nested under a `shortcut` key, which is how the event carries
 * it, and required rather than optional because a press either held a modifier
 * or it did not.
 */
export type ShortcutMessage = {
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * Which modifiers are held now.
 *
 * The page cannot see this for itself once a window has the keyboard —
 * `wl_keyboard.modifiers` goes to the focused surface — and a chrome whose
 * windows answer to a held modifier, alt to drag one, needs to know exactly
 * then. Sent on a change, so a modifier held down arrives once and letting go
 * arrives once; an ordinary key never appears here at all.
 *
 * The web's names, not xkb's masks: the compositor has already resolved
 * depressed/latched/locked against the keymap, and a page holding a mask could
 * not read it without the keymap too.
 */
export type ModifiersMessage = {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/**
 * The desktop, as it is now.
 *
 * The event that carries this is bare — `displayschanged` says the desktop
 * moved and `navigator.domicile.displays` says what it is. The bridge reads
 * the attribute and puts it here so a shell that wants to *react* to a change
 * gets the change and the desktop in one call, and one that wants to *read*
 * the desktop uses {@link BridgeClient.displays} instead.
 */
export type DisplaysMessage = {
  displays: readonly DomicileDisplay[];
};

/** Every message the bridge delivers, and what each one carries. */
export type HostMessageMap = {
  app_appeared: AppAppearedMessage;
  app_titled: AppTitledMessage;
  app_resized: AppResizedMessage;
  app_closed: AppClosedMessage;
  app_cursor: AppCursorMessage;
  focus_changed: FocusChangedMessage;
  focus_requested: FocusRequestedMessage;
  shortcut: ShortcutMessage;
  modifiers: ModifiersMessage;
  displays: DisplaysMessage;
};

/** The name of every message this build knows how to deliver. */
export type HostMessageType = keyof HostMessageMap;

/** Narrow a message to one variant, for a handler signature. */
export type HostMessageOf<T extends HostMessageType> = HostMessageMap[T];

/**
 * What a `DomicileAppEvent` for `appappeared` means.
 *
 * The translators below are the whole of the seam between WebIDL's shapes and
 * a shell's. They are pure functions over one event rather than statements
 * inside `bridge.ts`'s listeners because that is where the decisions are — a
 * zero that must not be read as a size, an empty string that means two
 * different nothings, a keyword the engine does not check — and a decision
 * inside a DOM listener cannot be asserted on: a throw there is reported to
 * the page's error handler rather than raised to whatever dispatched.
 */
export const appAppeared = (event: DomicileAppEvent): AppAppearedMessage => ({
  app_id: event.appId,
  // `hasSize` rather than a zero test. The zero is real — the engine fills the
  // numbers in with one when there is no size — and a client is entitled to be
  // configured to nothing, so a window that has merely not drawn yet has to be
  // a different fact from one that is zero pixels tall.
  size: event.hasSize ? [event.width, event.height] : undefined,
  title: named(event.title),
});

export const appTitled = (event: DomicileAppTitledEvent): AppTitledMessage => ({
  app_id: event.appId,
  title: named(event.title),
});

export const appResized = (event: DomicileAppEvent): AppResizedMessage => ({
  app_id: event.appId,
  // No `hasSize` test: a resize is the size, and one without it would be the
  // compositor telling the page nothing. Doubles, because this is a layout box
  // and a CSS pixel is fractional.
  size: [event.width, event.height],
});

export const appClosed = (event: DomicileAppEvent): AppClosedMessage => ({
  app_id: event.appId,
});

/**
 * What a client asked the chrome to show over its window.
 *
 * Parsed rather than passed through — see `cursor-shape.ts`. This is the last
 * value on the typed surface that is still a string the engine does not check,
 * and an unknown CSS keyword fails silently everywhere downstream.
 */
export const appCursor = (event: DomicileAppEvent): AppCursorMessage => ({
  app_id: event.appId,
  cursor: cursorShapeSchema.parse(event.cursor),
});

export const focusChanged = (event: DomicileAppEvent): FocusChangedMessage => ({
  app_id: named(event.appId),
});

export const focusRequested = (
  event: DomicileAppEvent,
): FocusRequestedMessage => ({
  app_id: event.appId,
});

export const shortcut = (event: DomicileShortcutEvent): ShortcutMessage => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  keycode: event.keycode,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});

export const modifiers = (event: DomicileModifiersEvent): ModifiersMessage => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});

/**
 * A `DOMString` that means a name, or `undefined` for one that means nothing.
 *
 * The engine has one spelling for absence and the page has two things to do
 * with it, so the collapse happens here rather than at every place a name or
 * an app id is read. Three callers, meaning the same thing differently: a
 * title nobody has set and a title set to nothing are both an unnamed window,
 * and an empty `appId` on `focuschanged` is the chrome holding the keyboard.
 */
const named = (value: string): string | undefined =>
  value === "" ? undefined : value;
