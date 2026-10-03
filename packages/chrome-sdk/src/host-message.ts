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

import { z } from "zod";

import type { AudioCard, AudioChoice, AudioDevice, AudioStream } from "./audio";
import type { CursorShape } from "./cursor-shape";
import { cursorShapeSchema } from "./cursor-shape";
import type {
  DomicileAppCursorEvent,
  DomicileAppEvent,
  DomicileAppsEvent,
  DomicileAppTitledEvent,
  DomicileAudioChoice,
  DomicileAudioDevice,
  DomicileAudioEvent,
  DomicileAudioStream,
  DomicileBatteryEvent,
  DomicileClipboardEntry,
  DomicileClipboardEvent,
  DomicileDisplay,
  DomicileExtensionsEvent,
  DomicileFilePreviewEvent,
  DomicileFilesEvent,
  DomicileIdleEvent,
  DomicileLockedEvent,
  DomicileModifiersEvent,
  DomicileNotificationsEvent,
  DomicileOpenUrlEvent,
  DomicileShellConfigEvent,
  DomicileShortcutEvent,
  DomicileThemeEvent,
  DomicileTrayEvent,
} from "./domicile-host";
import type { Extension } from "./extension";
import { extensionSchema } from "./extension";
import {
  FilePreview,
  FilePreviewKind,
  filePreviewKindSchema,
} from "./file-preview";
import { KeyAction } from "./key-action";
import type { Notification } from "./notification";
import { notificationUrgencySchema } from "./notification";
import { shellConfigSchema } from "./protocol";
import type { Theme } from "./theme";
import type { TrayItem } from "./tray";

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

/**
 * The smallest or the largest a client will draw its window, per axis, and
 * `undefined` on an axis it does not limit.
 *
 * A box outside it gets a frame that does not fill it: cut off at the box's
 * edge when the window will not shrink, stretched when it will not grow. A
 * shell that sizes windows keeps each inside its own.
 */
export type AppSizeLimitMessage = {
  app_id: string;
  size: readonly [width: number | undefined, height: number | undefined];
};

/**
 * A popup a client opened over one of its windows — a menu, a tooltip — or
 * moved. An `<app>` of its own for the shell to place rather than lay out: its
 * box is `size`, at `position` from the top-left of `parent`'s box, which is a
 * window or another popup and was always announced first. It goes with
 * `app_closed`, as a window does.
 *
 * Never a window: it has no title and is not tiled, and a click on it is a
 * click on its window as far as the keyboard goes — see
 * {@link DomicileClient.windowOf}. `grab` is a menu, which the compositor
 * dismisses when the keyboard leaves its window.
 */
export type PopupPlacedMessage = {
  app_id: string;
  grab: boolean;
  parent: string;
  position: readonly [x: number, y: number];
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
 * The applications and bookmarks a search matched, each best first: the
 * answer to {@link DomicileClient.searchApps}.
 */
export type FoundAppsMessage = {
  /** The query this answers. */
  query: string;
  apps: readonly DesktopEntry[];
  bookmarks: readonly Bookmark[];
};

/** A URL the desk offers by name; the shell opens it itself. */
export type Bookmark = {
  name: string;
  url: string;
  /**
   * The icon the site names for itself, as a `data:` URL, or `undefined` for
   * one the compositor has not found.
   */
  icon: string | undefined;
};

/** An application a desktop entry offers, as a launcher draws and runs it. */
export type DesktopEntry = {
  id: string;
  name: string;
  /** Empty for an entry that has none. */
  comment: string;
  /** The argv, for {@link DomicileClient.spawn}. */
  command: readonly string[];
  /** A `data:` URL to draw, or `undefined` for an icon that was not found. */
  icon: string | undefined;
  /** A picture of the application for a preview, the same way as `icon`. */
  preview: string | undefined;
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
 * How bright the screen is, as a shell reads it: a fraction, 0 through 1.
 *
 * Pushed like the battery, and like it absent rather than zero on a machine
 * with nothing to report — no backlight is no slider.
 */
export type BrightnessMessage = {
  level: number;
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
 * **Not the lock.** A dark screen is a screen, and going dark is not what stops
 * a keystroke. What stops one is the compositor, which holds the seat; nothing a
 * page does with this message makes it the thing that says no. The lock is
 * {@link LockedMessage}, which is a message of its own because the two are not
 * the same fact: a desk can be dark and open, and a locked desk somebody has
 * just wiggled the mouse at is lit and shut.
 *
 * A desktop that never blanks sends none of these, not even a `false` — so a
 * shell that has had no message has a desk with no opinion about who is at it,
 * and no idle affordance to draw.
 */
export type IdleMessage = {
  idle: boolean;
};

/**
 * Whether this desk is locked.
 *
 * `true` is a desktop that will not deliver a keystroke or a click to any
 * client until somebody says the passphrase; `false` is one that will.
 *
 * **The compositor holds it, and nothing this page does changes that.** Input
 * does not originate in the compositor — this page owns it and forwards it, and
 * the compositor injects it into a Wayland seat — so a locked desk is that
 * injection not happening. A reload does not open the desk, and neither does an
 * engine that died and came back.
 *
 * The page keeps its own keys throughout, which is what makes a lock screen
 * possible rather than a hole in one: this page is the thing forwarding, so it
 * can take a passphrase while nothing it forwards arrives anywhere. `unlock` is
 * how it offers one, and the answer is another one of these.
 *
 * A state rather than an edge, and a shell is told it again when its page
 * connects — which here is the whole point, since the reload is exactly what
 * must not open the desk.
 *
 * A desktop with no passphrase configured sends none of these, not even a
 * `false`: it cannot lock at all.
 */
export type LockedMessage = {
  locked: boolean;
};

/**
 * The extensions with an action, as a tray draws them.
 *
 * The whole list every time, like the clipboard, and once more when the page
 * connects: a reloaded shell is told rather than drawing an empty tray. The
 * state is each action's default until actions are per browser window.
 *
 * A click on one is `activateExtension(id)`, and then a `<webview>` at `popup`
 * when there is one.
 */
export type ExtensionsMessage = {
  extensions: readonly Extension[];
};

/**
 * The system tray, as a shell draws it.
 *
 * The whole tray every time, like the clipboard, and once more when the page
 * connects. A click on an icon is `activateTrayItem(id, action)`.
 */
export type TrayMessage = {
  items: readonly TrayItem[];
};

/** One key the config binds: the chord, and what pressing it does. */
export type Keybinding = {
  /** In `grabShortcut`'s terms, so it can be claimed as it stands. */
  shortcut: ShortcutMessage;
  action: KeyAction;
};

/**
 * The bindings of each binding mode, by the mode's name. `default` is always
 * there — it is the config's `[keybindings]` — though it can be empty.
 *
 * A map rather than a record because the names are the user's: a mode called
 * `constructor` is a mode, not a property every object already has.
 */
export type KeybindingsByMode = ReadonlyMap<string, readonly Keybinding[]>;

/** What the config tells one shell, by name, on top of the desk's bindings. */
export type ShellSection = {
  keybindings: KeybindingsByMode;
  /**
   * The shell's `[shells.<name>.options]` table, as JSON and unread: what it
   * means is the shell's to say, so the shell parses it. `{}` when the config
   * has none.
   */
  options: unknown;
};

/**
 * The keys the config binds, and what it tells each shell besides.
 *
 * `keybindings` is every shell's; `shells` is what only the shell of that name
 * adds. `bind-keys.ts` is what merges the two for one shell and answers the
 * presses — most shells want that rather than this.
 *
 * Once when the page connects and again whenever a reload changes it, whole
 * each time.
 */
export type ShellConfigMessage = {
  keybindings: KeybindingsByMode;
  shells: ReadonlyMap<string, ShellSection>;
};

/**
 * The desk's notifications, as a shell draws them.
 *
 * The whole list every time, oldest first, like the tray, and once more when
 * the page connects. Clearing is `dismissNotifications(ids)`; a press is
 * `invokeNotificationAction(id, action)`.
 */
export type NotificationsMessage = {
  items: readonly Notification[];
};

/**
 * An address somebody asked this desktop to open: `domicile open-url`, which
 * is what `BROWSER` runs for every app the desktop starts.
 *
 * Which window it goes in, and whether, is the shell's.
 */
export type OpenUrlMessage = {
  url: string;
};

/**
 * The desk's sound, as a mixer draws it: every output and input device,
 * every stream playing or recording, every sound card — each list in the
 * sound server's order.
 *
 * Whole every time, like the tray, and once more when the page connects. A
 * desk with no sound server sends none, so a shell that has had no message
 * has no mixer to draw. Monitors of the outputs are among `inputs`, flagged.
 */
export type AudioMessage = {
  outputs: readonly AudioDevice[];
  inputs: readonly AudioDevice[];
  playback: readonly AudioStream[];
  recording: readonly AudioStream[];
  cards: readonly AudioCard[];
};

/** Every message the client delivers, and what each one carries. */
export type HostMessageMap = {
  app_appeared: AppAppearedMessage;
  app_titled: AppTitledMessage;
  app_resized: AppResizedMessage;
  app_min_size: AppSizeLimitMessage;
  app_max_size: AppSizeLimitMessage;
  popup_placed: PopupPlacedMessage;
  app_closed: AppClosedMessage;
  app_cursor: AppCursorMessage;
  focus_changed: FocusChangedMessage;
  focus_requested: FocusRequestedMessage;
  shortcut: ShortcutMessage;
  modifiers: ModifiersMessage;
  displays: DisplaysMessage;
  battery: BatteryMessage;
  brightness: BrightnessMessage;
  audio: AudioMessage;
  clipboard: ClipboardMessage;
  theme: ThemeMessage;
  idle: IdleMessage;
  locked: LockedMessage;
  extensions: ExtensionsMessage;
  tray: TrayMessage;
  notifications: NotificationsMessage;
  open_url: OpenUrlMessage;
  /**
   * Which way round the desk's windows are drawn: `theme`'s other half,
   * arriving once they have turned. See {@link DomicileHost.themeCaptured}.
   */
  windows_theme: ThemeMessage;
  shell_config: ShellConfigMessage;
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

export const appSizeLimit = (event: DomicileAppEvent): AppSizeLimitMessage => ({
  app_id: event.appId,
  // xdg-shell's zero, which is no limit rather than a limit of nothing.
  size: [limit(event.width), limit(event.height)],
});

export const popupPlaced = (event: DomicileAppEvent): PopupPlacedMessage => ({
  app_id: event.appId,
  grab: event.grab,
  parent: event.parentAppId,
  position: [event.x, event.y],
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
 * What applications matched, with the engine's empty icons and preview
 * read as none.
 */
export const foundApps = (event: DomicileAppsEvent): FoundAppsMessage => ({
  apps: event.apps.map((entry) => ({
    command: entry.command,
    comment: entry.comment,
    icon: named(entry.icon),
    id: entry.id,
    name: entry.name,
    preview: named(entry.preview),
  })),
  bookmarks: event.bookmarks.map((bookmark) => ({
    icon: named(bookmark.icon),
    name: bookmark.name,
    url: bookmark.url,
  })),
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
    case FilePreviewKind.Audio: {
      return FilePreview.Audio({
        album: said(event.album),
        artist: said(event.artist),
        cover: said(event.cover),
        duration: event.duration,
        title: said(event.title),
      });
    }
    case FilePreviewKind.Binary: {
      return FilePreview.Binary();
    }
    case FilePreviewKind.Unreadable: {
      return FilePreview.Unreadable();
    }
  }
};

/** A tag the engine carries as empty, which is a song that did not say it. */
const said = (tag: string): string | undefined =>
  tag === "" ? undefined : tag;

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

/**
 * Whether the desk is locked, with the SDK's own `arrival` left behind.
 *
 * A pass-through like {@link idle}: the engine carries one boolean and that
 * boolean is the message. It exists so `domicile-client.ts` has the same one
 * call per listener every other event gets — and so that the one way this can be
 * wrong, which is backward, has somewhere to be asserted.
 */
export const locked = (event: DomicileLockedEvent): LockedMessage => ({
  locked: event.locked,
});

/**
 * An address to open. A pass-through like {@link locked}: the engine has
 * already refused one that is not a URL.
 */
export const openUrl = (event: DomicileOpenUrlEvent): OpenUrlMessage => ({
  url: event.url,
});

/**
 * The tray's rows, parsed.
 *
 * Parsed rather than passed through, for `appCursor`'s reason: the engine and
 * this SDK ship apart, and a row this SDK cannot draw -- an icon that is not a
 * PNG, an id `activateExtension` would not recognize -- should be a stack
 * rather than a button that does nothing. It is also where WebIDL's `null`
 * popup becomes `undefined`.
 */
export const extensions = (
  event: DomicileExtensionsEvent,
): ExtensionsMessage => ({
  extensions: z.array(extensionSchema).parse(event.extensions),
});

/**
 * The tray's icons, with the SDK's own `arrival` left behind and an empty
 * picture read as none — see {@link named}.
 */
export const tray = (event: DomicileTrayEvent): TrayMessage => ({
  items: event.items.map((item) => ({
    icon: named(item.icon),
    id: item.id,
    title: item.title,
  })),
});

/**
 * The config's keys, parsed out of the line the engine forwarded.
 *
 * The one translator that reads JSON: the engine cannot type a shell's
 * `options`, so it hands over the compositor's line unread — see
 * {@link DomicileShellConfigEvent} — and this is the boundary it is parsed at.
 * The wire's `send_shell` and `mode` become {@link KeyAction}s, and its
 * `shortcut` becomes `grabShortcut`'s dictionary.
 */
export const shellConfig = (
  event: DomicileShellConfigEvent,
): ShellConfigMessage => {
  const config = shellConfigSchema.parse(JSON.parse(event.config));
  return {
    keybindings: byMode(config.keybindings),
    shells: new Map(
      Object.entries(config.shells).map(([name, section]) => [
        name,
        { keybindings: byMode(section.keybindings), options: section.options },
      ]),
    ),
  };
};

/**
 * The desk's sound. The engine's empty strings — a device with no ports, a
 * stream with no title — become `undefined`, and its `isDefault` the
 * `default` C++ could not spell.
 */
export const audio = (event: DomicileAudioEvent): AudioMessage => ({
  cards: event.cards.map((card) => ({
    description: card.description,
    id: card.id,
    profile: named(card.profile),
    profiles: card.profiles.map(choice),
  })),
  inputs: event.inputs.map(device),
  outputs: event.outputs.map(device),
  playback: event.playback.map(stream),
  recording: event.recording.map(stream),
});

const choice = ({
  available,
  description,
  name,
}: DomicileAudioChoice): AudioChoice => ({ available, description, name });

const device = (engine: DomicileAudioDevice): AudioDevice => ({
  default: engine.isDefault,
  description: engine.description,
  id: engine.id,
  monitor: engine.monitor,
  muted: engine.muted,
  port: named(engine.port),
  ports: engine.ports.map(choice),
  volume: engine.volume,
});

const stream = (engine: DomicileAudioStream): AudioStream => ({
  application: engine.application,
  device: named(engine.device),
  id: engine.id,
  muted: engine.muted,
  title: named(engine.title),
  volume: engine.volume,
});

type WireKeybindings = z.infer<typeof shellConfigSchema>["keybindings"];

/** The wire's table of modes, as the map a shell reads. */
const byMode = (table: WireKeybindings): KeybindingsByMode =>
  new Map(
    Object.entries(table).map(([mode, bindings]) => [
      mode,
      bindings.map(({ action, shortcut: chord }) => ({
        action:
          action.type === "send_shell"
            ? KeyAction.SendShell(action.args)
            : KeyAction.Mode(action.name),
        shortcut: {
          altKey: chord.alt,
          ctrlKey: chord.ctrl,
          keycode: chord.key,
          metaKey: chord.logo,
          shiftKey: chord.shift,
        },
      })),
    ]),
  );

/**
 * The notifications, with the SDK's own `arrival` left behind, an empty
 * picture read as none and `-1` as a timeout left to the shell. The urgency is
 * parsed, because the engine carries it as a word: one it has no name for is
 * a compositor this SDK does not match, and throws.
 */
export const notifications = (
  event: DomicileNotificationsEvent,
): NotificationsMessage => ({
  items: event.items.map((item) => ({
    actions: item.actions.map(({ key, label }) => ({ key, label })),
    appName: item.appName,
    body: item.body,
    clickable: item.clickable,
    icon: named(item.icon),
    id: item.id,
    summary: item.summary,
    time: item.time,
    timeoutMs: item.timeoutMs < 0 ? undefined : item.timeoutMs,
    urgency: notificationUrgencySchema.parse(item.urgency),
  })),
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

/** One axis of a size limit, where xdg-shell's `0` is none. */
const limit = (pixels: number): number | undefined =>
  pixels === 0 ? undefined : pixels;
