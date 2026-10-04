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
import type { Theme } from "./theme";
import type { TrayAction } from "./tray";

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
   * of modes rather than a panel with no pixels. Description only: nothing
   * divides by it.
   */
  readonly modeWidth: number;
  readonly modeHeight: number;
  /**
   * Which way up the monitor is bolted to the desk: `normal`, `rotate-90`,
   * `rotate-180` or `rotate-270`.
   *
   * **Named for the `wl_output` value, which counts counterclockwise** — the
   * convention the config file and the host both follow. `rotate-90` is
   * content turned a quarter turn *counterclockwise*, for a panel bolted a
   * quarter turn clockwise; `rotate-270` is the clockwise quarter a panel on
   * its left side needs.
   */
  readonly transform: string;
};

/**
 * One client window, as {@link DomicileHost.windows} lists it: what the
 * compositor has said about it so far. Replaced, never edited — any change is
 * a new `windows` array and a `windowschanged`.
 */
export type DomicileWindow = {
  readonly appId: string;
  /** Empty until the client names itself. */
  readonly title: string;
  /** The size the client last committed, in CSS pixels; `null` until it has. */
  readonly width: number | null;
  readonly height: number | null;
  /** The limits the client asked for; `null` where it asked for none. */
  readonly minWidth: number | null;
  readonly minHeight: number | null;
  readonly maxWidth: number | null;
  readonly maxHeight: number | null;
  readonly cursor: CursorShape;
  /** A popup's parent window; `null` for a toplevel. */
  readonly parent: string | null;
  /** A popup's place relative to its parent; `null` for a toplevel. */
  readonly x: number | null;
  readonly y: number | null;
  /** Whether a popup grabbed the pointer; `false` for a toplevel. */
  readonly grab: boolean;
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
   * `popupplaced` only: the window or popup this popup is over, and where its
   * box goes from that one's top-left, in CSS pixels. Empty and zero on every
   * other event.
   */
  readonly parentAppId: string;
  readonly x: number;
  readonly y: number;
  /** `popupplaced` only: a menu, which grabbed; `false` for a tooltip. */
  readonly grab: boolean;

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
  /**
   * The chord as {@link DomicileHost.grabShortcut} was given it by name —
   * `Meta+Shift+l` — or empty for one grabbed as a keycode.
   */
  readonly chord: string;
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
 * What a path holds, answering {@link DomicileHost.previewFile}.
 *
 * `kind` is `text`, `directory`, `audio`, `binary` or `unreadable`; `text` is
 * filled for the first, `entries` for the second and the tags for the third,
 * and each is empty otherwise.
 */
export type DomicileFilePreviewEvent = Event & {
  /** The path this answers. */
  readonly path: string;

  readonly kind: string;

  /** The front of the file, for a `text` preview. */
  readonly text: string;

  /** The front of the directory, for a `directory` preview. */
  readonly entries: readonly string[];

  /** What a song says of itself, for an `audio` preview; empty if it does not. */
  readonly title: string;
  readonly artist: string;
  readonly album: string;

  /** How long an `audio` preview plays, in seconds. */
  readonly duration: number;

  /** The picture an `audio` preview carries of itself, as a `data:` URL. */
  readonly cover: string;

  /** When the browser process had it, on `performance.now()`'s clock. */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * An application a desktop entry offers.
 *
 * An interface on the engine's side rather than a plain object, for
 * {@link DomicileClipboardEntry}'s reason.
 */
export type DomicileDesktopEntry = {
  /** The desktop file ID: its path under `applications/`, `/` read as `-`. */
  readonly id: string;

  /** `Name`, unlocalized. */
  readonly name: string;

  /** `Comment`, or empty for an entry that has none. */
  readonly comment: string;

  /**
   * `Exec`, as the argv it runs: unquoted, with its field codes dropped. Hand
   * it to {@link DomicileHost.spawn}; nothing on the page parses an `Exec`
   * line.
   */
  readonly command: readonly string[];

  /**
   * The icon the entry names, as a `data:` URL to draw, or empty for one the
   * compositor did not find.
   */
  readonly icon: string;

  /**
   * The picture the entry names for a launcher's preview,
   * `X-Domicile-Preview`, the same way as {@link icon}.
   */
  readonly preview: string;
};

/** A URL the desk offers by name, from its config. */
export type DomicileBookmark = {
  /** What a launcher's row says. */
  readonly name: string;

  /** What choosing it opens; the shell opens it itself. */
  readonly url: string;

  /**
   * The icon the site names for itself, as a `data:` URL the compositor
   * fetched, or empty for one it has not found.
   */
  readonly icon: string;
};

/**
 * The applications and bookmarks a {@link DomicileHost.searchApps} matched,
 * each best first.
 */
export type DomicileAppsEvent = Event & {
  /** The query this answers. */
  readonly query: string;

  readonly apps: readonly DomicileDesktopEntry[];

  readonly bookmarks: readonly DomicileBookmark[];

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/** What {@link DomicileHost.searchFiles} resolves with; see {@link DomicileFilesEvent}. */
export type DomicileFileSearch = Pick<
  DomicileFilesEvent,
  "files" | "matched" | "indexing"
>;

/** What {@link DomicileHost.previewFile} resolves with; see {@link DomicileFilePreviewEvent}. */
export type DomicileFilePreview = Pick<
  DomicileFilePreviewEvent,
  | "kind"
  | "text"
  | "entries"
  | "title"
  | "artist"
  | "album"
  | "duration"
  | "cover"
>;

/** What {@link DomicileHost.searchApps} resolves with; see {@link DomicileAppsEvent}. */
export type DomicileAppSearch = Pick<DomicileAppsEvent, "apps" | "bookmarks">;

/**
 * What matched a {@link DomicileHost.searchFiles}, answering it and nothing
 * else — the compositor's index of the home never crosses into the page.
 *
 * Paths relative to the home directory the desktop is running as, sorted, and
 * a directory ends in `/`. Only the front of what matched is here; `matched`
 * is how many there were. A home that could not be read is no event at all,
 * because "you have no files" is not something a broken desktop should be
 * able to say.
 */
export type DomicileFilesEvent = Event & {
  /** The query this answers. */
  readonly query: string;

  readonly files: readonly string[];

  /** How many paths matched, of which {@link files} is the front. */
  readonly matched: number;

  /**
   * Whether the compositor is still building the index this was found in.
   *
   * **The difference between an incomplete answer and a wrong one.** The rows
   * are a launcher's whole evidence that a file exists, so an answer from an
   * index still being walked has to arrive saying so — otherwise a person who
   * typed the name of a file the walk has not reached yet is told, in the only
   * language a launcher has, that they do not have it. Draw it, and ask again.
   */
  readonly indexing: boolean;

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

/**
 * One thing that was copied, as a row of the clipboard's history.
 *
 * An interface on the engine's side rather than a plain object, for
 * {@link DomicileDisplay}'s reason: WebIDL will not have a dictionary as the
 * type of an attribute. What a shell does with one is draw the preview and
 * hand the id back.
 */
export type DomicileClipboardEntry = {
  /**
   * What {@link DomicileHost.copyClipboardEntry} names this row by.
   *
   * Assigned by the compositor and never reused, so an id a shell is holding
   * either names the row it was told about or names nothing at all. Not a
   * position: the list a copy re-orders keeps every id it had.
   */
  readonly id: number;

  /**
   * Enough of what was copied to recognize it by, and not necessarily all of
   * it.
   *
   * The whole entry for nearly every copy; a long one is cut, because this is
   * drawn as a row and the rest of a copied file is not a row. What goes back
   * on the clipboard is always the whole thing.
   */
  readonly preview: string;
};

/**
 * What has been copied on this desktop, newest first.
 *
 * **A page cannot read this for itself, and `navigator.clipboard` is the trap
 * that looks like it can.** That API answers out of the browser's own
 * clipboard, which on the platform this engine scans out on is not connected
 * to any Wayland client at all — so a shell reading it would be reading what
 * the shell itself copied and nothing a window did. The compositor is the
 * process a `wl_data_device.set_selection` arrives at, and this is that.
 *
 * Pushed, like the battery: sent whenever the history changes, and again to a
 * page that has just connected. An empty list is a desktop nothing has been
 * copied on yet, which is an answer rather than a gap.
 */
export type DomicileClipboardEvent = Event & {
  /** The rows, newest first. */
  readonly entries: readonly DomicileClipboardEntry[];

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/** One icon in the system tray, as the compositor read it off the bus. */
export type DomicileTrayItem = {
  /** What {@link DomicileHost.activateTrayItem} names this icon by. */
  readonly id: string;
  /** What it is, in words: never empty. */
  readonly title: string;
  /**
   * The picture, as a `data:` URL, or empty for one the compositor could not
   * draw.
   */
  readonly icon: string;
};

/**
 * The system tray: every application showing an icon, in the order they
 * registered.
 *
 * **A page cannot read this for itself.** An icon is a StatusNotifierItem on
 * the session bus, which the compositor hosts and a page has no way to reach.
 *
 * Pushed, like the clipboard, and the whole tray every time: sent whenever an
 * icon arrives, leaves or changes how it looks, and again to a page that has
 * just connected. An empty list is a desk no application has put an icon on.
 */
export type DomicileTrayEvent = Event & {
  /** The icons, in the order their applications registered. */
  readonly items: readonly DomicileTrayItem[];

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/** One button of a notification. */
export type DomicileNotificationAction = {
  /** What {@link DomicileHost.invokeNotificationAction} names it by. */
  readonly key: string;
  /** What the button says. */
  readonly label: string;
};

/** One notification, as the compositor took it up. */
export type DomicileNotification = {
  /** What the host's dismiss and invoke calls name it by. */
  readonly id: number;
  /** Who sent it, as it named itself; may be empty. */
  readonly appName: string;
  readonly summary: string;
  /** Plain text, never markup; may be empty. */
  readonly body: string;
  /** A `data:` URL, or empty for nothing to draw. */
  readonly icon: string;
  /** `"low"`, `"normal"` or `"critical"`. */
  readonly urgency: string;
  readonly actions: readonly DomicileNotificationAction[];
  /** Whether it offers the `"default"` action: a press on it. */
  readonly clickable: boolean;
  /**
   * Milliseconds it asked to stay up: `0` for until dismissed, `-1` for the
   * shell's choice.
   */
  readonly timeoutMs: number;
  /** Milliseconds since the epoch, on the compositor's clock. */
  readonly time: number;
};

/**
 * The desk's notifications: every one not yet cleared, oldest first.
 *
 * **A page cannot read these for itself.** A notification is a call to
 * `org.freedesktop.Notifications` on the session bus, which the compositor
 * serves — a page's own Web Notification included, because the browser shows
 * one by calling that server.
 *
 * Pushed, like the tray, and the whole list every time: sent whenever one
 * arrives, is replaced or is let go of, and again to a page that has just
 * connected. Which are new is the shell's to tell.
 */
export type DomicileNotificationsEvent = Event & {
  /** The notifications, oldest first. */
  readonly items: readonly DomicileNotification[];

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Which way round the desktop is drawn now.
 *
 * **A page cannot work this out for itself, and `prefers-color-scheme` is the
 * trap that looks like it can.** That media query reports the engine's own
 * notion of a system preference, and under Domicile there is no system above
 * the desktop to have one — the shell *is* the desktop's chrome. The theme is
 * the compositor's: out of `theme.mode` in its config, and out of whatever
 * {@link DomicileHost.setTheme} has done to it since.
 *
 * Pushed, like the battery, and the one pushed event a page can cause: it
 * answers a `setTheme`, to every chrome on the desk rather than to the one
 * that called. It also arrives when this page connects — so a shell paints in
 * the desk's theme rather than painting and flipping — and whenever a reload
 * of the config moves the theme.
 */
export type DomicileThemeEvent = Event & {
  readonly theme: Theme;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Whether anybody is at this desktop, pushed when that changes.
 *
 * **A page cannot see this for itself, and `document.visibilityState` is the
 * trap that looks like it can.** A shell is the desktop: its document stays
 * visible while the glass is off, because the compositor turns the connector
 * off and tells the browser nothing about it — so every idle signal the web
 * platform has reads "somebody is here" on a desk nobody has been at for an
 * hour. The compositor is what counts the hands, and this is that count.
 *
 * Pushed, like the battery: it arrives on the turn the answer changes and once
 * more to a page that has just connected — so a page that reloaded while the
 * desk was idle is told, rather than left drawing a desktop somebody is at.
 * A desktop with no idle timeout configured sends none of these at all.
 *
 * It does not lead the blanking: the screens go dark in the same breath it
 * arrives. What it leads is the relight, which takes tens of milliseconds
 * against a repaint's one.
 */
export type DomicileIdleEvent = Event & {
  /** `true` is a desk nobody is at; `false` is somebody back at it. */
  readonly idle: boolean;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * Whether this desk is locked, pushed when that changes.
 *
 * **The compositor holds this, and that is the whole of why it is a message.**
 * Input on this system does not originate there: your page owns it and forwards
 * it, and the compositor injects it into a Wayland seat. While `locked` is
 * `true` that injection does not happen — so no client on the desk sees a
 * keystroke or a click, and nothing your page does changes that. A reload does
 * not open the desk, an engine that died and came back does not open it, and
 * neither does a shell edited in the devtools of the browser drawing it.
 *
 * Your page keeps its own keys throughout, which reads like a hole and is the
 * opposite: you are the thing forwarding, so you can draw a lock screen and
 * take a passphrase while nothing you forward arrives anywhere. {@link
 * DomicileHost.unlock} is how you offer one.
 *
 * Pushed, like the battery: it arrives on the turn the answer changes and once
 * more to a page that has just connected — which here is the point rather than a
 * convenience, because the edge a reloaded page missed is the one that would
 * have raised its lock screen. A desktop with no passphrase configured sends
 * none of these at all.
 */
export type DomicileLockedEvent = Event & {
  /** `true` is a desk that delivers nothing to any client. */
  readonly locked: boolean;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * The keyboard, for the keys a shell binds: every keysym it can type and the
 * key it is on.
 *
 * **A string, and JSON in it.** The compositor's `shell_config` line, exactly
 * as it was sent: the engine forwards the line without reading it, and
 * `host-message.ts` is the first thing that does.
 *
 * Pushed when this page connects and again whenever a reload of the config
 * moves the keyboard.
 */
export type DomicileShellConfigEvent = Event & {
  readonly config: string;

  /**
   * When the browser process had this message, in `performance.now()`'s
   * milliseconds. See {@link DomicileModifiersEvent.arrival}, which documents
   * what this is and what it is not.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/** A port of a device, or a profile of a card. */
export type DomicileAudioChoice = {
  readonly name: string;
  readonly description: string;
  readonly available: boolean;
};

/** An output or an input, as the engine hands it over. */
export type DomicileAudioDevice = {
  readonly id: string;
  readonly description: string;
  readonly volume: number;
  readonly muted: boolean;
  /** Whether new streams go to it. `default` is a word C++ keeps. */
  readonly isDefault: boolean;
  readonly monitor: boolean;
  readonly ports: readonly DomicileAudioChoice[];
  /** The port in use, or empty for a device with none. */
  readonly port: string;
};

/** Something playing or recording, as the engine hands it over. */
export type DomicileAudioStream = {
  readonly id: string;
  readonly application: string;
  /** Empty where the application said nothing. */
  readonly title: string;
  readonly volume: number;
  readonly muted: boolean;
  /** Empty for a device the next event will settle. */
  readonly device: string;
};

/** One meter, as the engine hands it over. */
export type DomicileAudioLevel = {
  readonly id: string;
  /** The loudest sample since the last event, 0 through 1 of full scale. */
  readonly peak: number;
};

/**
 * How loud what {@link DomicileHost.watchAudioLevels} asked for is: some
 * twenty times a second while anything is metered.
 */
export type DomicileAudioLevelsEvent = Event & {
  readonly levels: readonly DomicileAudioLevel[];
  /** See {@link DomicileModifiersEvent.arrival}. */
  readonly arrival: DOMHighResTimeStamp;
};

/** A sound card, as the engine hands it over. */
export type DomicileAudioCard = {
  readonly id: string;
  readonly description: string;
  readonly profiles: readonly DomicileAudioChoice[];
  /** The profile in use, or empty. */
  readonly profile: string;
};

/**
 * The desk's sound: every output and input, every stream, every sound card,
 * each list in the sound server's order.
 *
 * Pushed whenever the sound server says something moved, and once more when
 * this page connects. Never on a desk with no sound server.
 */
export type DomicileAudioEvent = Event & {
  readonly outputs: readonly DomicileAudioDevice[];
  readonly inputs: readonly DomicileAudioDevice[];
  readonly playback: readonly DomicileAudioStream[];
  readonly recording: readonly DomicileAudioStream[];
  readonly cards: readonly DomicileAudioCard[];

  /**
   * When the browser process had this message. See
   * {@link DomicileModifiersEvent.arrival}.
   */
  readonly arrival: DOMHighResTimeStamp;
};

/**
 * An address somebody asked this desktop to open: `domicile open-url`, which is
 * what `BROWSER` runs for every app the desktop starts.
 *
 * Already a valid URL — the engine refuses one that is not. Which window it
 * goes in, and whether, is yours.
 */
export type DomicileOpenUrlEvent = Event & {
  /** The address. */
  readonly url: string;
};

/**
 * One extension with an action, as the tray draws it.
 *
 * An interface on the engine's side rather than a plain object, for
 * {@link DomicileClipboardEntry}'s reason. The state is the action's default
 * — Chrome's tab `-1` — until actions are per browser window.
 */
export type DomicileExtension = {
  /** What {@link DomicileHost.activateExtension} names it by. */
  readonly id: string;
  readonly name: string;
  /** The action's tooltip. */
  readonly title: string;
  /**
   * A `data:image/png` URL, rendered at the page's device pixel ratio. Not a
   * `chrome-extension://` URL: `action.setIcon({imageData})` sets an icon that
   * has none.
   */
  readonly icon: string;
  readonly badgeText: string;
  /** A CSS color, `#rrggbbaa`. Fully transparent when the extension set none. */
  readonly badgeColor: string;
  /**
   * The popup to open in a `<webview>` when the action is clicked, or `null`
   * for an action whose click is its `action.onClicked`. Either way the click
   * is {@link DomicileHost.activateExtension}.
   */
  readonly popup: string | null;
  /** Whether the action is enabled: `action.disable()` makes it `false`. */
  readonly enabled: boolean;
};

/**
 * The extensions with an action, whole, whenever any of them changes — and
 * once to a page that has just connected, so a reload is told rather than left
 * with an empty tray.
 *
 * No `arrival`, unlike the compositor's events: the browser process is where
 * an action's state lives, so there is no socket read to stamp.
 */
export type DomicileExtensionsEvent = Event & {
  readonly extensions: readonly DomicileExtension[];
};

/** Every event `window.domicile` fires, and what each one carries. */
export type DomicileHostEventMap = {
  appappeared: DomicileAppEvent;
  appresized: DomicileAppEvent;
  /**
   * The smallest a client will draw its window, as `width` and `height` with
   * `0` for no limit on that axis — xdg-shell's `set_min_size`.
   */
  appminsize: DomicileAppEvent;
  /** The largest, as {@link DomicileHostEventMap.appminsize} is the smallest. */
  appmaxsize: DomicileAppEvent;
  /**
   * A client opened a popup over one of its windows, or moved one — see
   * `popup_placed` in `domicile-protocol`.
   */
  popupplaced: DomicileAppEvent;
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
  /** What a {@link DomicileHost.searchFiles} found. Only ever an answer. */
  files: DomicileFilesEvent;
  /** What a {@link DomicileHost.previewFile} found. Only ever an answer. */
  filepreview: DomicileFilePreviewEvent;
  /** What a {@link DomicileHost.searchApps} found. Only ever an answer. */
  apps: DomicileAppsEvent;
  /** The charge, whenever it moves far enough to draw. Nobody asked for it. */
  battery: DomicileBatteryEvent;
  /** What has been copied, whenever that changes. Nobody asked for it either. */
  clipboard: DomicileClipboardEvent;
  /**
   * Which way round the desktop is drawn. Pushed like the two above, and the
   * one of the three a page can cause — see {@link DomicileHost.setTheme}.
   */
  theme: DomicileThemeEvent;
  /**
   * Whether anybody is at the desk, whenever that changes — and once to a page
   * that has just connected, which is the whole reason it carries the state
   * rather than the edge the compositor decided on.
   */
  idle: DomicileIdleEvent;
  /**
   * Whether this desk is locked, whenever that changes — and once to a page
   * that has just connected, which is what makes a reload something the lock
   * survives rather than something that opens it.
   */
  locked: DomicileLockedEvent;
  /**
   * Which way round the desk's windows are drawn: `theme`'s other half. It
   * arrives once they have turned — see {@link DomicileHost.themeCaptured} —
   * and on connecting.
   */
  windowstheme: DomicileThemeEvent;
  /**
   * The keys the config binds and each shell's options, once on connecting
   * and whenever a reload changes them.
   */
  shellconfig: DomicileShellConfigEvent;
  audio: DomicileAudioEvent;
  audiolevels: DomicileAudioLevelsEvent;
  /**
   * The extensions with an action, whole, whenever one changes and once on
   * connecting.
   */
  extensions: DomicileExtensionsEvent;
  /**
   * The system tray, whole, whenever an icon arrives, leaves or changes, and
   * once on connecting.
   */
  tray: DomicileTrayEvent;
  /** An address to open — see {@link DomicileOpenUrlEvent}. */
  openurl: DomicileOpenUrlEvent;
  /**
   * The desk's notifications, whole, whenever one arrives, changes or goes,
   * and once on connecting.
   */
  notifications: DomicileNotificationsEvent;
  /**
   * The desktop changed: a screen arrived or left, a display was resized, or
   * its density moved. Bare — read {@link DomicileHost.displays} for what it
   * is now.
   */
  displayschanged: Event;
  /**
   * The brightness moved. Bare — read {@link DomicileHost.brightness} for
   * where it is now.
   */
  brightnesschanged: Event;
  /**
   * A window appeared, closed, or changed. Bare — read
   * {@link DomicileHost.windows} for what they are now.
   */
  windowschanged: Event;
  /**
   * The compositor said where the keyboard is. Bare — read
   * {@link DomicileHost.focusedWindow}. Every time, not only when it moves, and
   * once after the windows already running are replayed to a page that has
   * just connected: a window listed after the first of these is one opened
   * now.
   */
  focusedwindowchanged: Event;
  /** Bare: the attribute it names moved. */
  clipboardchanged: Event;
  /** Bare: the attribute it names moved. */
  traychanged: Event;
  /** Bare: the attribute it names moved. */
  notificationschanged: Event;
  /** Bare: the attribute it names moved. */
  extensionschanged: Event;
  /** Bare: the attributes it names moved. */
  audiochanged: Event;
  /** Bare: the attributes it names moved. */
  batterychanged: Event;
  /** Bare: the attribute it names moved. */
  idlechanged: Event;
  /** Bare: the attribute it names moved. */
  lockedchanged: Event;
  /** Bare: the attribute it names moved. */
  themechanged: Event;
  /** Bare: the attribute it names moved. */
  windowsthemechanged: Event;
  /** Bare: the attributes it names moved. */
  modifierschanged: Event;
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
   * Ask what in the home matches `query`. Resolves with the answer, which
   * also arrives as a `files` event carrying the same query. A newer call
   * supersedes this one, which rejects with an `AbortError`.
   *
   * **It takes no path, and that is the security property rather than an
   * oversight.** A shell is served over `domicile://` precisely so that it has
   * an origin without a port, not so that it gets a filesystem; a call that
   * named a directory would be one, and every document the engine serves would
   * have it. What is searched is the compositor's to decide — see
   * `domicile_host::file_search` — and this only asks it to look.
   *
   * **The compositor matches, and only what matched crosses.** Its index is
   * the whole home, which on a real one is hundreds of thousands of paths; a
   * page that was handed that list to filter was a desktop that took no input
   * while it arrived.
   */
  searchFiles(query: string): Promise<DomicileFileSearch>;

  /**
   * Ask what `path` holds. Resolves with the answer, which also arrives as a
   * `filepreview` event carrying the same path. A newer call supersedes this
   * one, as with {@link searchFiles}.
   *
   * **This one names a path**, and what keeps it from being a filesystem is
   * that the compositor answers only for a path its index of the home holds —
   * anything else is `unreadable`. So a page reads nothing a search could not
   * already have named. See `domicile_host::file_preview`.
   */
  previewFile(path: string): Promise<DomicileFilePreview>;

  /**
   * Ask which installed applications match `query`. Resolves with the
   * answer, which also arrives as an `apps` event carrying the same query. A
   * newer call supersedes this one, as with {@link searchFiles}.
   *
   * Words, like {@link searchFiles}: which directories hold the desktop
   * entries is the compositor's to read. See `domicile_host::desktop_entries`.
   */
  searchApps(query: string): Promise<DomicileAppSearch>;

  /**
   * Put a row of the clipboard's history back on the clipboard.
   *
   * **It names a row and carries no text**: a page that could put arbitrary bytes
   * on the seat's clipboard would be writing the desktop's clipboard rather
   * than choosing among what is already on it. The `id` is one the last
   * `clipboard` event carried.
   *
   * There is no answer. What follows is that every Wayland client now pastes
   * that entry, and the compositor serves it — so the row outlives the client
   * that first copied it, which is the whole of what a manager is for.
   */
  copyClipboardEntry(entry: number): void;

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

  /**
   * Draw the desktop the other way round.
   *
   * **The one call here that says what the desktop *is*** rather than asking
   * it for something. It reaches the compositor and comes back as a `theme`
   * event — to every chrome on the desk, this one included, which is why a
   * shell renders from the event rather than from its own click. Three
   * monitors are three pages and the toggle is on one of them.
   *
   * It leaves the page at all because the compositor is the only process the
   * desk's *clients* can hear: it answers the settings portal GTK, Qt and
   * Electron read a color scheme from, out of this same value. A theme kept in
   * the page would be a desktop whose panels went dark and whose windows
   * stayed light.
   *
   * Not written back to the config file, which is generated — `theme.mode`
   * is what the desk comes up on, and a toggle lasts as long as the desktop.
   */
  setTheme(theme: Theme): void;

  /**
   * Offer a passphrase at a locked desk.
   *
   * **The only way out of the one desktop state your page cannot change by
   * drawing.** While the desk is locked the compositor puts nothing you forward
   * into the seat; this call is what ends that, and only if the compositor
   * agrees.
   *
   * Answered with a `locked` event and not with a return value — to every chrome
   * on the desk, not just this one, because three monitors are three pages and
   * the desk they draw has one lock. So clear your lock screen when the event
   * says the desk opened, never because you believed your own keystrokes: a page
   * that did the latter would be a lock anybody with the devtools could open.
   *
   * A wrong passphrase produces a `locked` event saying the desk is still
   * locked: nothing else sends one to a desk being checked, so a page waiting on
   * its check reads it as the refusal. There is no count and no delay on this
   * protocol yet; the compositor says why in its own log, without the
   * passphrase in it.
   */
  unlock(passphrase: string): void;

  /**
   * Lock this desk now, whoever is at it.
   *
   * Answered like {@link unlock}: with a `locked` event to every chrome, and
   * only when the desk actually shut. A desktop with no lock configured has
   * nothing to shut, and sends nothing.
   */
  lock(): void;

  /**
   * Set the screen's backlight to `level`, 0 through 1.
   *
   * A request, like {@link setTheme}: answered with `brightnesschanged` to
   * every chrome once the backlight has moved. The compositor never turns the
   * screen all the way off, and a level that is not a number throws.
   */
  setBrightness(level: number): void;

  /**
   * The mixer: set a device's or a stream's volume, a fraction of the sound
   * server's 100%; mute it; make a device the default; move a stream to
   * another device of its direction; switch a device's port or a card's
   * profile. Each names what it acts on by an id from the last `audio` event.
   *
   * Requests, like {@link setBrightness}: answered with the next `audio` to
   * every chrome once the sound server has moved. An id the compositor never
   * gave out does nothing but say so in its log.
   */
  setAudioVolume(id: string, volume: number): void;
  setAudioMuted(id: string, muted: boolean): void;
  setDefaultAudioDevice(id: string): void;
  moveAudioStream(id: string, device: string): void;
  setAudioPort(id: string, port: string): void;
  setAudioProfile(card: string, profile: string): void;

  /**
   * Meter these devices and streams, by the ids an `audio` event carried,
   * and fire `audiolevels` with their peaks.
   *
   * **A lease**: call it again every second while the meters are on screen.
   * The compositor stops metering what nobody renewed — metering a microphone
   * records it — and an empty list lets go at once.
   */
  watchAudioLevels(ids: readonly string[]): void;

  /**
   * This page's old frame is held for `theme`: turn the desk's windows now.
   *
   * Called from inside a shell's wipe, once the frame it wipes away from is
   * captured. The windows are in that frame, so they have to still be drawn
   * the old way when it is taken and the new way when the wipe starts — which
   * is only true if they are told in between. The compositor waits for every
   * chrome on the desk (or gives up waiting), tells the windows, and answers
   * with a `windowstheme` event once they have repainted.
   */
  themeCaptured(theme: Theme): void;

  /**
   * Route a key combination to the page rather than to the focused client.
   *
   * By name — `grabShortcut("Meta+Shift+l")`, in sway's grammar — the engine
   * finds the key the keysym is on and finds it again whenever the layout
   * changes. The press comes back as a `shortcut` event whose `chord` is this
   * string, whether it was pressed in a `<webview>` or on this page — where it
   * is taken from the page.
   *
   * As a {@link DomicileShortcut}, the press comes back carrying the same
   * fields and an empty `chord`.
   *
   * @throws `SyntaxError` for a chord written wrong; `NotFoundError` for a
   *   keysym the keyboard cannot type, once the compositor has described it.
   */
  grabShortcut(shortcut: string | DomicileShortcut): void;

  /**
   * Click an extension's action, popup or not: grants it `activeTab` on the
   * active tab, then dispatches `action.onClicked` for an action with no
   * popup. One with a popup is opened by the shell, as a `<webview>` at
   * {@link DomicileExtension.popup}.
   */
  activateExtension(id: string): void;

  /**
   * Click an icon in the system tray, with the button `action` names. What the
   * click does is the application's; an icon whose application has gone does
   * nothing, and an empty id throws.
   */
  activateTrayItem(id: string, action: TrayAction): void;

  /**
   * Clear notifications: ids a `notifications` event carried. Each
   * application hears its notification was dismissed; an id already gone is
   * passed over.
   */
  dismissNotifications(ids: readonly number[]): void;

  /**
   * Press one of a notification's actions — `"default"` for the notification
   * itself. Its application hears the key, and the notification is let go of.
   * An action it never offered does nothing.
   */
  invokeNotificationAction(id: number, action: string): void;

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

  /**
   * How bright the screen is, 0 through 1 — an attribute for the reason
   * {@link displays} is one. `null` until the compositor has said, and for
   * ever on a machine with no backlight.
   */
  readonly brightness: number | null;

  /**
   * Every client window, in the order they appeared. Reading it binds the
   * channel, and the compositor announces the windows already running as it
   * does, so a shell that reads late misses nothing: read, then listen for
   * `windowschanged`. A different frozen array after every change.
   */
  readonly windows: readonly DomicileWindow[];

  /** The window holding the keyboard, or `null` when the shell's page holds it. */
  readonly focusedWindow: string | null;

  // THE DESK'S STATE. Each is what the compositor last said, `null` until it
  // has said anything; a bare `<name>changed` says it moved.
  readonly clipboard: readonly DomicileClipboardEntry[] | null;
  readonly tray: readonly DomicileTrayItem[] | null;
  readonly notifications: readonly DomicileNotification[] | null;
  readonly extensions: readonly DomicileExtension[] | null;
  readonly audioOutputs: readonly DomicileAudioDevice[] | null;
  readonly audioInputs: readonly DomicileAudioDevice[] | null;
  readonly audioPlayback: readonly DomicileAudioStream[] | null;
  readonly audioRecording: readonly DomicileAudioStream[] | null;
  readonly audioCards: readonly DomicileAudioCard[] | null;
  readonly batteryCharge: number | null;
  readonly batteryCharging: boolean | null;
  readonly idle: boolean | null;
  readonly locked: boolean | null;
  readonly theme: Theme | null;
  readonly windowsTheme: Theme | null;
  /** The compositor seat's — see the README before trusting them. */
  readonly altKey: boolean | null;
  readonly ctrlKey: boolean | null;
  readonly shiftKey: boolean | null;
  readonly metaKey: boolean | null;

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
