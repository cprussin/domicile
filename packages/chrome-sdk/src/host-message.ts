// What `DomicileClient.on` hands a shell, and what it is called.
//
// One layer below this is `window.domicile`, whose events are typed but are
// shaped for WebIDL: a `DOMString` that is empty rather than absent, a
// `hasSize` boolean beside the numbers it guards, one event class doing five
// jobs. One layer above it is a shell, which wants the thing that happened and
// only the fields that happened with it. This is the vocabulary in between —
// the names, and the translators that turn one of the engine's events into
// one of them. `domicile-client.ts` is what calls them, once per listener.
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
  DomicileAppCursorEvent,
  DomicileAppEvent,
  DomicileAppTitledEvent,
  DomicileBatteryEvent,
  DomicileClipboardEntry,
  DomicileClipboardEvent,
  DomicileDisplay,
  DomicileFilePreviewEvent,
  DomicileFilesEvent,
  DomicileIdleEvent,
  DomicileModifiersEvent,
  DomicileShortcutEvent,
  DomicileThemeEvent,
} from "./domicile-host";
import {
  FilePreview,
  FilePreviewKind,
  filePreviewKindSchema,
} from "./file-preview";
import type { Theme } from "./theme";

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
 * its own requests would be right until the first click and wrong afterward.
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
 * moved and `window.domicile.displays` says what it is. The client reads
 * the attribute and puts it here so a shell that wants to *react* to a change
 * gets the change and the desktop in one call, and one that wants to *read*
 * the desktop uses {@link DomicileClient.displays} instead.
 */
export type DisplaysMessage = {
  displays: readonly DomicileDisplay[];
};

/**
 * What a search of the home found: the answer to
 * {@link DomicileClient.searchFiles}, and never anything more.
 *
 * `files` is the front of what matched — paths relative to the home directory,
 * `Notes/today.org` rather than `/home/you/Notes/today.org`, in the order they
 * go on screen, and a directory ends in `/`. `matched` is how many there were
 * in all. The index itself stays in the compositor: it is the whole home, and
 * a page has no use for the rows nobody asked for.
 */
export type FoundFilesMessage = {
  /** The query this answers. */
  query: string;
  files: readonly string[];
  matched: number;
  /**
   * Whether the index the answer was found in is still being built.
   *
   * **The difference between an incomplete answer and a wrong one**, and a
   * thing a shell cannot work out for itself: a short answer from an index
   * still being walked and a short answer from a small home look identical.
   * Say so on screen, and ask again.
   */
  indexing: boolean;
};

/**
 * What a path holds: the answer to {@link DomicileClient.previewFile}.
 */
export type FilePreviewMessage = {
  /** The path this answers. */
  path: string;
  preview: FilePreview;
};

/**
 * The machine's battery, as a shell reads it.
 *
 * Pushed rather than asked for: it arrives when the charge moves far enough to
 * draw, and once more when a page connects. A machine with no battery sends
 * nothing at all, so a shell that has had no message has no meter to draw
 * rather than a battery at zero.
 *
 * `charge` is a fraction, 0 through 1, and `charging` is whether a lead is in
 * — a full battery on AC is `true`, because what a bar draws from it is a plug
 * rather than a rate.
 */
export type BatteryMessage = {
  charge: number;
  charging: boolean;
};

/**
 * What has been copied on this desktop, newest first.
 *
 * Pushed rather than asked for, like the battery: it arrives whenever the
 * history changes and once more when a page connects. An empty list is a
 * desktop nothing has been copied on yet — an answer, and the ordinary state
 * of one that has just started, since the history is in memory and never on
 * disk.
 *
 * A row is an id and a preview. The compositor keeps the bytes, so a shell
 * that wants one back calls `copyClipboardEntry` with the id rather than
 * holding what was copied — which matters, because a password manager's copy
 * is a row in this list.
 */
export type ClipboardMessage = {
  entries: readonly DomicileClipboardEntry[];
};

/**
 * Which way round the desktop is drawn now.
 *
 * Pushed like the battery and the clipboard, and the one of the three a page
 * can cause: `setTheme` is answered with it, to every chrome on the desk
 * rather than to the one that called. It also arrives when the page connects,
 * so a shell paints in the desk's theme rather than painting and flipping.
 *
 * **Not `prefers-color-scheme`**, which is the media query this looks like it
 * duplicates: that reports the engine's own notion of a system preference, and
 * a Domicile shell has no system above it to have one. See `theme.ts`.
 */
export type ThemeMessage = {
  theme: Theme;
};

/**
 * Whether anybody is at this desktop.
 *
 * `true` is a desk nobody has touched for as long as its config says, `false`
 * is somebody back at it. A state rather than an edge, and a shell is told it
 * again when its page connects — so a shell whose page reloaded while the desk
 * was idle comes back knowing, instead of drawing a desktop somebody is at.
 *
 * **It does not lead the blanking.** The screens go dark in the same breath
 * this arrives, so there is no warning here to fade on or count down with:
 * what the idle edge is good for is arranging what will be true when the
 * screens come *back*, because a relight takes tens of milliseconds and a
 * repaint takes one.
 *
 * **Not a lock.** A dark screen is a screen and anybody can type at one. What
 * stops the keys is the compositor, which holds the seat; nothing a page does
 * with this message makes it the thing that says no.
 *
 * A desktop that never blanks sends none of these, not even a `false` — so a
 * shell that has had no message has a desk with no opinion about who is at it,
 * and no idle affordance to draw.
 */
export type IdleMessage = {
  idle: boolean;
};

/** Every message the client delivers, and what each one carries. */
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
  battery: BatteryMessage;
  clipboard: ClipboardMessage;
  theme: ThemeMessage;
  idle: IdleMessage;
  /**
   * Which way round the desk's windows are drawn: `theme`'s other half,
   * arriving once they have turned. See {@link DomicileHost.themeCaptured}.
   */
  windows_theme: ThemeMessage;
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
 * inside `domicile-client.ts`'s listeners because that is where the decisions
 * are — a zero that must not be read as a size, an empty string that means two
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
 * Parsed rather than passed through, even though `event.cursor` is now a
 * `DomicileCursorShape` and the bindings hold it to the same closed set. The
 * DOM is a boundary, and this SDK ships apart from the engine it runs
 * against — `engine-release.nix` pins a tarball a shell's `bun install` knows
 * nothing about — so a shape added to this list before the engine that has it
 * is deployed arrives as a string no `DomicileCursorShape` names. An unknown
 * CSS keyword fails silently everywhere downstream, so the parse is what turns
 * that skew into a stack.
 */
export const appCursor = (event: DomicileAppCursorEvent): AppCursorMessage => ({
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

/**
 * What a search found, passed through rather than translated.
 *
 * A `FrozenArray<DOMString>` is already an array of strings to a page, and the
 * order it arrives in is the answer — so this is the one translator with no
 * decision in it, and it exists so that `domicile-client.ts` has the same one
 * call per listener that every other event gets. `arrival` is left behind, as
 * everywhere else here.
 */
export const foundFiles = (event: DomicileFilesEvent): FoundFilesMessage => ({
  files: event.files,
  indexing: event.indexing,
  matched: event.matched,
  query: event.query,
});

/**
 * What a path holds, with the engine's `kind` word parsed.
 *
 * Parsed rather than trusted for the reason `appCursor` is: the engine and
 * this SDK ship apart, and a kind this SDK cannot name would otherwise draw as
 * an empty preview with nothing said.
 */
export const filePreview = (
  event: DomicileFilePreviewEvent,
): FilePreviewMessage => ({
  path: event.path,
  preview: previewOf(event),
});

/** The one preview `event`'s kind carries. */
const previewOf = (event: DomicileFilePreviewEvent): FilePreview => {
  const kind = filePreviewKindSchema.parse(event.kind);
  switch (kind) {
    case FilePreviewKind.Text: {
      return FilePreview.Text(event.text);
    }
    case FilePreviewKind.Directory: {
      return FilePreview.Directory(event.entries);
    }
    case FilePreviewKind.Binary: {
      return FilePreview.Binary();
    }
    case FilePreviewKind.Unreadable: {
      return FilePreview.Unreadable();
    }
  }
};

/** The charge, with the SDK's own `arrival` left behind: no shell draws it. */
export const battery = (event: DomicileBatteryEvent): BatteryMessage => ({
  charge: event.charge,
  charging: event.charging,
});

/**
 * The clipboard's history, with the SDK's own `arrival` left behind.
 *
 * A pass-through like {@link files}: the engine's rows are already an id and a
 * preview, which is what a shell draws and what it hands back. The translator
 * exists so `domicile-client.ts` has the same one call per listener that every
 * other event gets.
 */
export const clipboard = (event: DomicileClipboardEvent): ClipboardMessage => ({
  entries: event.entries,
});

/**
 * The desktop's theme, with the SDK's own `arrival` left behind.
 *
 * A pass-through like {@link files}: the engine's `theme` is a
 * `DomicileTheme`, which is the closed set this SDK spells — the bindings
 * refuse anything else on the way in, and `setTheme` refuses it on the way
 * out. Nothing to parse and nothing to fall back to.
 */
export const theme = (event: DomicileThemeEvent): ThemeMessage => ({
  theme: event.theme,
});

/**
 * Whether anybody is at the desk, with the SDK's own `arrival` left behind.
 *
 * A pass-through like {@link files}: the engine carries one boolean and that
 * boolean is the message. It exists so `domicile-client.ts` has the same one
 * call per listener that every other event gets — and so that the one way this
 * can be wrong, which is backward, has somewhere to be asserted.
 */
export const idle = (event: DomicileIdleEvent): IdleMessage => ({
  idle: event.idle,
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
