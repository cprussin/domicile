// Generated from the engine's WebIDL by `codegen/generate-domicile-host.ts`.
// Do not edit. Change the IDL in
// `packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`
// and run `bun run generate` in `packages/chrome-sdk`.
//
// The desktop a shell is handed (`Shell(root, domicile)`). There is no global;
// a shell keeps what it was handed. See `shell.ts`.
//
// Sizes and coordinates are fractional CSS pixels, except in `DomicileDisplay`.
// Keycodes are Linux evdev codes.

/**
 * The cursors a client can ask the chrome to show over its window.
 *
 * The `wp_cursor_shape_v1` shapes, named by the CSS `cursor` keyword the
 * chrome assigns, plus `none` for a hidden cursor. The same set is defined by
 * `domicile_protocol::CursorShape`, `components/domicile/common/cursor_shape.h`
 * and `cursorShapeSchema` in `@domicile/chrome-sdk`.
 *
 * An enum, not a DOMString, so the bindings reject unknown values. CSS ignores
 * an unknown cursor keyword, so a bad value would otherwise show the wrong
 * cursor with no error.
 *
 * Keep the values in the same order as the other lists:
 * `scripts/test-cursor-shapes-agree.sh` compares all four as sequences.
 */
export type DomicileCursorShape =
  | "none"
  | "default"
  | "context-menu"
  | "help"
  | "pointer"
  | "progress"
  | "wait"
  | "cell"
  | "crosshair"
  | "text"
  | "vertical-text"
  | "alias"
  | "copy"
  | "move"
  | "no-drop"
  | "not-allowed"
  | "grab"
  | "grabbing"
  | "e-resize"
  | "n-resize"
  | "ne-resize"
  | "nw-resize"
  | "s-resize"
  | "se-resize"
  | "sw-resize"
  | "w-resize"
  | "ew-resize"
  | "ns-resize"
  | "nesw-resize"
  | "nwse-resize"
  | "col-resize"
  | "row-resize"
  | "all-scroll"
  | "zoom-in"
  | "zoom-out";

/**
 * The desktop's light or dark theme.
 *
 * One of four copies of this set: `domicile_protocol::Theme`,
 * `components/domicile/common/theme.h`, this enum, and `themeSchema` in
 * `@domicile/chrome-sdk`.
 *
 * An enum rather than a `DOMString` because `setTheme()` takes it, so the
 * bindings reject an invalid value at the call. There is no `system` value:
 * the compositor owns the theme.
 *
 * Keep the order in sync with the other copies. `mojom::Theme` is numbered by
 * position, and `scripts/test-themes-agree.sh` compares the order.
 */
export type DomicileTheme = "dark" | "light";

/**
 * Which button clicked a tray icon: StatusNotifierItem's Activate,
 * SecondaryActivate and ContextMenu.
 *
 * An enum rather than a `DOMString` because activateTrayItem() takes it, so
 * the bindings reject an invalid value at the call.
 *
 * Keep the order in sync with `mojom::TrayAction`, which is numbered by
 * position.
 */
export type DomicileTrayAction = "primary" | "secondary" | "context";

export type DomicileAppEventInit = EventInit & {
  appId?: string;
};

/** What `DomicileHost.previewFile()` resolves with. */
export type DomicileFilePreview = {
  /**
   * Which of the rest means anything: "text", "directory", "audio", "binary"
   * or "unreadable". "unreadable" is also what a path outside the compositor's
   * index of the home gets -- see previewFile(). A DOMString rather than an
   * enum: the browser drops an answer whose kind is not one of the five.
   */
  readonly kind: string;
  /** The front of the file, for "text". */
  readonly text: string;
  /** What is in it, for "directory": names, a subdirectory ending in `/`. */
  readonly entries: readonly string[];
  /**
   * What a song says of itself, for "audio": each tag empty when it does not
   * say it.
   */
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** How long it plays, in seconds, for "audio". */
  readonly duration: number;
  /**
   * The picture it carries of itself, for "audio", as a `data:` URL -- the
   * page cannot read the file to draw one of its own.
   */
  readonly cover: string;
};

/** What `DomicileHost.searchFiles()` resolves with. */
export type DomicileFileSearch = {
  /**
   * The front of what matched: paths relative to the home directory the
   * desktop is running as -- `Notes/today.org`, not
   * `/home/you/Notes/today.org` -- already in the order they go on screen, and
   * a directory ends in `/`. Empty is a query that matched nothing.
   */
  readonly files: readonly string[];
  /** How many paths matched, of which `files` is the front. */
  readonly matched: number;
  /**
   * Whether the compositor is still building the index this was found in.
   *
   * THE DIFFERENCE BETWEEN AN INCOMPLETE ANSWER AND A WRONG ONE. The rows are
   * a launcher's whole evidence that a file exists, so an answer from an index
   * still being walked has to arrive saying so. A shell draws this as a line
   * saying the index is being built, and asks again.
   */
  readonly indexing: boolean;
};

/**
 * A key combination the desktop grabs.
 *
 * Same fields as `DomicileShortcutEvent`, so a shell can compare a press
 * against it directly. `keycode` is a Linux evdev code; `KeyboardEvent.key` is
 * already a string such as "Enter".
 */
export type DomicileShortcut = {
  keycode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

export type DomicileShortcutEventInit = EventInit & {
  chord?: string;
  keycode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

/**
 * The event behind DomicileHost.onfocusrequested: a client asked for the
 * keyboard.
 */
export type DomicileAppEvent = Event & {
  /** The window that asked: the id an <app> element names. */
  readonly appId: string;
};

/**
 * One of the desk's browser windows: a page the browser holds, drawn with
 * `<webview window="id">`. See components/domicile/mojom/browser_windows.mojom.
 *
 * An interface for DomicileDisplay's reason: these are read from the
 * desktop's `browserWindows` attribute, and WebIDL forbids a dictionary as an
 * attribute type.
 */
export type DomicileBrowserWindow = {
  /**
   * The id `<webview window>` and closeBrowserWindow() use. Never reused while
   * the browser runs.
   */
  readonly id: string;
  /** The page's address. Empty before it has shown anything. */
  readonly url: string;
  /** The page's title. Empty when the page has none. */
  readonly title: string;
  /**
   * The extension popup window (chrome.windows) whose one tab this is. Null
   * for a tab of the desk's own window.
   */
  readonly popupWindow: number | null;
  /**
   * The size the popup window asked for, in CSS pixels. 0 on an axis it left
   * unset.
   */
  readonly width: number;
  readonly height: number;
};

/**
 * One thing that was copied, as a row of the clipboard's history.
 *
 * An interface rather than a dictionary because WebIDL will not have a
 * dictionary as the element type of an attribute's array, which is how these
 * are read -- off DomicileHost.clipboard rather than handed over in a call.
 */
export type DomicileClipboardEntry = {
  /**
   * What DomicileHost.copyClipboardEntry() names this row by.
   *
   * Assigned by the compositor and never reused, so an id a shell is holding
   * either names the row it was told about or names nothing at all. NOT a
   * position: the list a copy re-orders keeps every id it had.
   */
  readonly id: number;
  /**
   * Enough of what was copied to recognize it by, and not necessarily all of
   * it: a long copy is cut down to a row, because this is what a panel draws
   * and the rest of a copied file is not a row.
   *
   * What goes back on the clipboard is always the whole thing, which is the
   * reason a row is an id and a preview rather than the text: the bytes stay
   * in the compositor, and a password manager's copy is a row in this list.
   */
  readonly preview: string;
};

/**
 * One screen of the desktop.
 *
 * An interface because WebIDL does not allow a dictionary as an attribute type.
 *
 * Sizes are integers because the desktop config uses whole pixels. Other sizes
 * on this channel come from layout boxes and are fractional.
 */
export type DomicileDisplay = {
  /**
   * The compositor's name for this screen from the config, such as `left`.
   * `domicile-0` when Domicile runs in a window instead of driving displays.
   */
  readonly name: string;
  /**
   * The top-left corner in desktop coordinates. The origin is the top-left of
   * the displays' bounding box. Signed because the config can place a display
   * left of or above the origin.
   */
  readonly x: number;
  readonly y: number;
  /** The logical size, in the CSS pixels a shell lays out in. */
  readonly width: number;
  readonly height: number;
  /**
   * The scale advertised to Wayland clients on this screen. This is not the
   * shell's `devicePixelRatio`: the shell is one page at one density across
   * all screens.
   */
  readonly scale: number;
  /**
   * The panel's mode in physical pixels, before rotation. A portrait 4K
   * panel has a 3840x2160 mode and an 1800x3200 logical size. The mode does
   * not follow from the size because `scale` is an integer.
   *
   * Zero when the desktop has no modes, such as when running in a window.
   */
  readonly modeWidth: number;
  readonly modeHeight: number;
  /**
   * The monitor's rotation: `normal`, `rotate-90`, `rotate-180` or
   * `rotate-270`, as the config file spells them.
   *
   * Follows the wl_output convention: the name is the clockwise turn applied
   * to content, not the panel's turn. A shell applies it as written.
   *
   * A DOMString because an enum would need another IDL file and another patched
   * entry in `bindings/idl_in_modules.gni`. The browser maps any other name to
   * `normal`.
   */
  readonly transform: string;
};

/**
 * One extension with an action, as a shell's tray draws it.
 *
 * An interface rather than a dictionary for DomicileClipboardEntry's reason:
 * WebIDL will not have a dictionary as the element type of an attribute's
 * array, and these are read off DomicileHost.extensions.
 *
 * The state is the active tab's -- the <webview> that last had focus -- or the
 * action's default where there is none. See docs/architecture/EXTENSIONS.md.
 */
export type DomicileExtension = {
  /** What DomicileHost.activateExtension() names it by. */
  readonly id: string;
  readonly name: string;
  /** The action's tooltip. */
  readonly title: string;
  /**
   * data:image/png;base64,..., drawn at this page's device pixel ratio. Not a
   * chrome-extension:// URL: action.setIcon({imageData}) sets an icon that has
   * none.
   */
  readonly icon: string;
  readonly badgeText: string;
  /** A CSS color, #rrggbbaa. Fully transparent when the extension set none. */
  readonly badgeColor: string;
  /**
   * The popup a click opens, in a <webview> the shell draws; null for an
   * action whose click is its `action.onClicked`. Either way the click is
   * activateExtension().
   */
  readonly popup: string | null;
  /** False after the extension's action.disable(). */
  readonly enabled: boolean;
};

/** Every event `DomicileHost` fires, by name. */
export type DomicileHostEventMap = {
  /** A grabbed shortcut fired, as a DomicileShortcutEvent. */
  shortcut: DomicileShortcutEvent;
  /**
   * A shortcut that fired was let go: its key came up, or one of its
   * modifiers did, wherever the keyboard is. As a DomicileShortcutEvent.
   */
  shortcutrelease: DomicileShortcutEvent;
  /**
   * A client asked for the keyboard, as a DomicileAppEvent naming it; nothing
   * has moved. The shell answers by calling focusApp(), or does not, which
   * refuses it.
   */
  focusrequested: DomicileAppEvent;
  /**
   * The desktop changed: a screen arrived or left, a display was resized, or
   * its density moved. Read `displays` for what it is now.
   */
  displayschanged: Event;
  /**
   * A window appeared, closed, or changed: its title, size, limits, cursor or
   * popup placement. Read `windows` for what they are now.
   */
  windowschanged: Event;
  /**
   * The compositor said where the keyboard is: `focusedWindow` may have
   * changed. Every time, and once after the windows already running are
   * replayed to a page that has just connected -- which is how a page tells a
   * window opened now from one that was running.
   */
  focusedwindowchanged: Event;
  clipboardchanged: Event;
  traychanged: Event;
  notificationschanged: Event;
  extensionschanged: Event;
  idlechanged: Event;
  lockedchanged: Event;
  themechanged: Event;
  windowsthemechanged: Event;
  modifierschanged: Event;
  /**
   * Fires when a window opens, closes, navigates or changes title. Read
   * `browserWindows` for the current list.
   */
  browserwindowschanged: Event;
  /**
   * An answer to callSystem(), as a MessageEvent whose `data` is the
   * compositor's `system_reply`, `system_event` or `system_end` line.
   */
  system: MessageEvent<string>;
  /**
   * Every unanswered portal request, as a MessageEvent whose `data` is the
   * compositor's `portal_requests` line. Fired on every change. A listener
   * added later is sent the latest line, so a shell that listens late still
   * sees pending dialogs.
   */
  portalrequests: MessageEvent<string>;
};

/**
 * The desktop a shell is handed — the shell's control channel to the compositor.
 *
 * Not a web standard and not proposed as one. It exists in Domicile's engine
 * fork, on documents served over domicile://, and nowhere else.
 *
 * This is the typed surface rather than a message pipe: the page calls methods
 * and listens for events, and the wire protocol lives in the browser process.
 * The reason is that the protocol carries Spawn, and a page that cannot
 * construct a message cannot construct a malformed one. The cost, which is
 * real, is that adding a message means an engine release rather than editing a
 * TypeScript file.
 */
export type DomicileHost = {
  /**
   * Run a command on the machine running the desktop.
   *
   * Sequence<DOMString> rather than a single string: splitting a command line
   * is a shell's job and there is no shell in this path.
   */
  spawn(command: readonly string[]): void;
  /**
   * Ask what in the home matches `query`. Resolves with the answer. A newer
   * call supersedes this one, which rejects with an AbortError: a launcher
   * wants the answer to what is typed now.
   *
   * IT TAKES NO PATH, AND THAT IS THE POINT RATHER THAN AN OVERSIGHT. A shell
   * is served over domicile:// so that it has an origin without a TCP port,
   * not so that it gets a filesystem. A call that named a directory would be
   * one, and every document this engine serves would have it. What gets
   * searched is the compositor's decision -- see `domicile_host::file_search`
   * -- and the query is only words to match.
   *
   * ONLY WHAT MATCHED CROSSES. The compositor's index is the whole home; a
   * page handed that to filter was a desktop that took no input while it
   * arrived.
   */
  searchFiles(query: string): Promise<DomicileFileSearch>;
  /**
   * Ask what is in one file. Resolves with the answer. A newer call
   * supersedes this one, as with searchFiles().
   *
   * THIS ONE TAKES A PATH, which searchFiles() above says is the point of not
   * taking one -- so what it may name is narrow: a path relative to the home,
   * as searchFiles() named it (a directory without its trailing `/`). The
   * compositor answers only for a path in its own index of the home, and
   * anything else comes back "unreadable", so this reads nothing a search
   * could not already have named.
   */
  previewFile(path: string): Promise<DomicileFilePreview>;
  /**
   * A system call: a file, a directory, a watch or a process. `request` is
   * the call as JSON, such as `{"call":"read_file","path":"/sys/x"}`. Answered
   * with `system` events whose `data` carries `id`. The compositor checks
   * every call, the lock included. See docs/SHELL-SYSTEM-ACCESS.md and
   * the SDK's `system` module, which is the way to call this.
   */
  callSystem(id: number, request: string): void;
  /**
   * Answer portal request `id`, which a `portalrequests` event listed.
   * `answer` is JSON with a string `kind`, such as `{"kind":"access"}`. One
   * that is not is dropped in the browser. The compositor checks the rest. See
   * packages/domicile-compositor/src/portals/README.md.
   */
  answerPortalRequest(id: number, answer: string): void;
  /**
   * Put a row of the clipboard's history back on the clipboard.
   *
   * IT NAMES A ROW AND CARRIES NO TEXT: a shell is served over domicile:// so
   * that it has an origin, not so that it gets the machine, and a call that
   * took bytes would let this document write the desktop's clipboard rather
   * than choose among what has already been copied on it. `entry` is an id
   * `clipboard` lists.
   *
   * No answer, and none to want: what follows is that the next paste in any
   * window is that row, served by the compositor rather than by whichever
   * client first copied it -- which is the whole of what a clipboard manager
   * is for. An id the history has since dropped sets nothing.
   */
  copyClipboardEntry(entry: number): void;
  /**
   * Click an icon in the system tray, with the button `action` names.
   *
   * It names an icon `tray` lists and a button, and nothing about
   * what the click does, for copyClipboardEntry's reason: that is the
   * application's. An id that names no icon now is a click that raced the
   * application going away, and does nothing; an empty one throws.
   */
  activateTrayItem(id: string, action: DomicileTrayAction): void;
  /**
   * Clear notifications: ids `notifications` lists. Each application hears
   * its notification was dismissed, and the next `notificationschanged`
   * leaves them out. An id already gone is passed over.
   */
  dismissNotifications(ids: readonly number[]): void;
  /**
   * Press one of a notification's actions -- "default" for the notification
   * itself. It names a notification and a key it offered, and nothing about
   * what the press does, for copyClipboardEntry's reason: that is the
   * application's. An empty action throws.
   */
  invokeNotificationAction(id: number, action: string): void;
  /**
   * Which window has the keyboard: the compositor's seat, and where the keys
   * this page hears are sent. focusChrome() takes it back to the page.
   */
  focusApp(appId: string): void;
  focusChrome(): void;
  /**
   * Put the pointer at a place in this page, in the page's own coordinates --
   * the ones a PointerEvent reports as clientX/clientY.
   *
   * THE COMPANION TO MOVING THE KEYBOARD. A desktop whose focus follows the
   * cursor has to take the cursor with it when a key moves the focus, or the
   * next pointer event hands the focus back to whatever the pointer is still
   * over. Every other compositor does this itself; here the shell is a page,
   * and a page can read where the pointer is and cannot put it anywhere.
   *
   * Doubles for resizeApp's reason: a place in a page is a CSS pixel and a CSS
   * pixel is fractional. A coordinate outside this page is clamped to its own
   * box -- what a page may move is the pointer over itself -- and NaN throws.
   */
  warpPointer(x: number, y: number): void;
  /**
   * Ask a client to close. Not a kill -- the client decides, which is why a
   * window can refuse and show a save dialog instead.
   */
  closeApp(appId: string): void;
  /**
   * The layout box, as a resize. For an <app> the box IS the configure.
   *
   * Doubles because a CSS pixel is fractional and this comes from a layout box.
   */
  resizeApp(appId: string, width: number, height: number): void;
  /**
   * Where the page put an <app>, in the page's CSS pixels. The client draws at
   * the scale of the monitor holding most of that box. Layout still places the
   * window; this only tells the compositor where it ended up.
   */
  setAppBounds(
    appId: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  /**
   * Draw the desktop the other way round.
   *
   * THE ONE CALL HERE THAT SAYS WHAT THE DESKTOP IS rather than asking it for
   * something. It reaches the compositor and comes back as `themechanged` --
   * to every chrome on the desk, this one included, which is why a shell
   * renders from `theme` rather than from its own click. Three monitors are
   * three pages and the toggle is on one of them.
   *
   * It has to leave the page at all because the compositor is the only process
   * the desk's CLIENTS can hear: it answers the settings portal GTK, Qt and
   * Electron read a color scheme from, out of this same value. A theme kept in
   * the renderer would be a desktop whose panels went dark and whose windows
   * stayed light.
   *
   * A DomicileTheme rather than a DOMString, so a word that is not one of the
   * two is refused at the call instead of at the socket -- see
   * domicile_theme.idl.
   */
  setTheme(theme: DomicileTheme): void;
  /**
   * Offer a passphrase at a locked desk.
   *
   * THE WAY OUT OF THE ONE STATE THIS PAGE CANNOT CHANGE BY DRAWING. While the
   * desk is locked the compositor puts nothing this page forwards into the
   * Wayland seat -- no client sees a keystroke or a click -- and this call is
   * the only thing that ends it. The page keeps its own keys throughout, which
   * is what makes a lock screen possible: it is the thing forwarding, so it can
   * take a passphrase while nothing it forwards arrives anywhere.
   *
   * ANSWERED WITH `lockedchanged` AND NOT WITH A RETURN VALUE, and only when
   * the desk actually opened. A wrong passphrase produces nothing at all: the
   * compositor says so in its own log, without the passphrase in it. A page
   * that cleared its own lock screen because it believed its own keystrokes
   * would be a lock anybody with the devtools could open -- and the event goes
   * to every chrome on the desk rather than to this one, because three monitors
   * are three pages and the desk they draw has one lock.
   */
  unlock(passphrase: string): void;
  /**
   * Lock the desk now, whoever is at it. Answered like unlock(): with
   * `lockedchanged` to every chrome, and only when the desk actually shut.
   */
  lock(): void;
  /**
   * This page's old frame is held for `theme`: turn the desk's windows now.
   *
   * Called from inside a shell's wipe, once the frame it wipes away from is
   * captured, so that the wipe passes across windows that turn inside it
   * rather than over windows that had already turned. Answered with a
   * `windowsthemechanged` once every chrome has called it and the windows have
   * had their chance to repaint -- or once the compositor stopped waiting.
   */
  themeCaptured(theme: DomicileTheme): void;
  /**
   * Route a key combination to the page rather than to the focused client.
   *
   * The press comes back as a `shortcut` event carrying the same fields, so a
   * shell compares what it grabbed against what fired without parsing a string.
   *
   * The same, by name: `grabShortcut("Meta+Shift+l")`, in sway's grammar. The
   * engine finds the key the keysym is on, from the keyboard the compositor
   * describes, and finds it again whenever the layout changes. The press comes
   * back as a `shortcut` event whose `chord` is this string -- pressed in a
   * `<webview>` or on this page, where it is taken from the page.
   *
   * Throws a SyntaxError for a chord written wrong, and a NotFoundError for a
   * keysym the keyboard cannot type; before any keyboard is described, that
   * one is a console warning once it is.
   */
  grabShortcut(shortcut: DomicileShortcut | string): void;
  /**
   * Click an extension's action, popup or not: the extension is granted
   * activeTab on the active tab, as a toolbar click grants it in Chrome. Then
   * an action with no popup has its `action.onClicked` dispatched; one with a
   * popup is the shell's to open, as a <webview> at the `popup` its
   * `extensions` entry names, and is opened after this call.
   *
   * NOT THE COMPOSITOR'S. An action lives in this browser, so the call goes no
   * further than the browser process, over the tray's own pipe -- see
   * components/domicile/mojom/extension_tray.mojom. An id that names no
   * extension with an action now is a click that raced an uninstall, and does
   * nothing; an empty one throws.
   */
  activateExtension(id: string): void;
  /**
   * Opens a browser window at `url`, for the shell's own UI such as a `+`
   * button or a launcher. It appears in the next `browserwindowschanged`. A
   * domicile:// address shows blocked, as in a <webview>.
   */
  openBrowserWindow(url: string): void;
  /**
   * Closes window `id`; it leaves the next `browserwindowschanged`. An unknown
   * id does nothing.
   */
  closeBrowserWindow(id: string): void;
  /**
   * The screens of the desktop.
   *
   * An attribute rather than an event payload, because the desktop is a fact
   * and not a stream. A shell reads this when it needs it -- including a
   * component that mounts long after the description arrived, which an event
   * would have left with nothing.
   *
   * NULL UNTIL THE COMPOSITOR HAS DESCRIBED THE DESKTOP, and an empty array
   * for a desktop with no screens on it. They are different states and a shell
   * renders them differently: nothing at all is what an unknown screen shows,
   * which is the right answer for "there is no such screen" and the wrong one
   * for "wait". `domicile-protocol` carries that distinction deliberately --
   * an empty `Vec` that serializes to nothing and one that serializes to `[]`
   * both come back empty, and only the second is a desktop a shell can parse
   * -- and an attribute that started empty threw it away again here.
   *
   * The compositor describes at least one output, so it does not send the
   * empty one; the `domicile` daemon, which no desktop has been described to,
   * does. Leaning on "in practice it never happens" is what made the SDK guess,
   * and this is instead of the guess.
   *
   * No [SameObject]: the compositor sends the whole desktop each time it
   * changes and a FrozenArray is frozen, so this is a different array after
   * every `displayschanged`. That is also the shape a shell wants -- an
   * identity that survived a desktop it no longer describes would be worse.
   */
  readonly displays: readonly DomicileDisplay[] | null;
  /**
   * Every client window on the desktop, in the order they appeared: what the
   * compositor has said about each so far. Reading it binds the channel, and
   * the compositor announces the windows already running as it does, so a
   * shell that reads late misses nothing -- it reads, then listens for
   * `windowschanged`. A different array after every change, for `displays`'s
   * reason.
   */
  readonly windows: readonly DomicileWindow[];
  /** The window holding the keyboard, or null when the shell's page holds it. */
  readonly focusedWindow: string | null;
  /**
   * THE DESK'S STATE, AS ATTRIBUTES. Each is what the compositor last said,
   * null until it has said anything, and a bare `<name>changed` event says it
   * moved: a shell reads, then listens, and one that listens late misses
   * nothing. See docs/architecture/WINDOW-DOMICILE.md.
   */
  readonly clipboard: readonly DomicileClipboardEntry[] | null;
  readonly tray: readonly DomicileTrayItem[] | null;
  readonly notifications: readonly DomicileNotification[] | null;
  readonly extensions: readonly DomicileExtension[] | null;
  readonly idle: boolean | null;
  readonly locked: boolean | null;
  readonly theme: DomicileTheme | null;
  readonly windowsTheme: DomicileTheme | null;
  /**
   * The compositor seat's modifiers -- only the keys forwarded to a client;
   * see @domicile-desktop/sdk's README before trusting them over a page's
   * own key events.
   */
  readonly altKey: boolean | null;
  readonly ctrlKey: boolean | null;
  readonly shiftKey: boolean | null;
  readonly metaKey: boolean | null;
  /**
   * The desk's browser windows, oldest first. Null until the browser lists
   * them, which it does as soon as this page listens. The browser holds each
   * page; draw one with `<webview window="id">`. A shell loaded over this one
   * gets the same windows and pages. See
   * components/domicile/mojom/browser_windows.mojom.
   *
   * A window a program opens (`domicile open-url`, a page's target="_blank",
   * an extension) appears here in the next `browserwindowschanged`. No
   * [SameObject], for `displays`' reason.
   */
  readonly browserWindows: readonly DomicileBrowserWindow[] | null;
  /**
   * Typed by the event map rather than by inheriting `EventTarget`, whose
   * overloads take any name and type every listener's event as `Event`.
   * `dispatchEvent` is left out: a page does not dispatch to it.
   */
  addEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void;
  removeEventListener<T extends keyof DomicileHostEventMap>(
    type: T,
    listener: (event: DomicileHostEventMap[T]) => void,
  ): void;
};

/**
 * One notification: an application's call to org.freedesktop.Notifications,
 * which the compositor serves -- a page's own Web Notification included,
 * because the browser shows one by calling that server.
 *
 * An interface rather than a dictionary for DomicileTrayItem's reason: these
 * are read off DomicileHost.notifications.
 */
export type DomicileNotification = {
  /**
   * What DomicileHost.dismissNotifications() and invokeNotificationAction()
   * name this notification by. One its application replaced keeps its id.
   */
  readonly id: number;
  /** Who sent it, as it named itself. May be empty. */
  readonly appName: string;
  /** The one line that says what happened. */
  readonly summary: string;
  /** More, as plain text: the compositor tells senders it takes no markup. */
  readonly body: string;
  /**
   * The picture, as a `data:` URL, or empty for nothing to draw. A URL rather
   * than a path for DomicileTrayItem.icon's reason.
   */
  readonly icon: string;
  /**
   * "low", "normal" or "critical": the spec's urgency hint. A word rather than
   * an enum because it is only ever read, and the SDK parses it.
   */
  readonly urgency: string;
  /** Its buttons. A press on the notification itself is `clickable`. */
  readonly actions: readonly DomicileNotificationAction[];
  /** Whether it offers the "default" action: a press on the notification. */
  readonly clickable: boolean;
  /**
   * How long it asked to stay up, in milliseconds: 0 for until it is
   * dismissed, -1 for the shell's choice.
   */
  readonly timeoutMs: number;
  /**
   * When it arrived or was last replaced, in milliseconds since the epoch on
   * the compositor's clock.
   */
  readonly time: number;
};

/**
 * One button of a notification.
 *
 * An interface rather than a dictionary because these are read off a
 * DomicileNotification's array; see DomicileTrayItem.
 */
export type DomicileNotificationAction = {
  /** The id DomicileHost.invokeNotificationAction() takes. */
  readonly key: string;
  /** The button's label. */
  readonly label: string;
};

/**
 * A combination claimed with grabShortcut() was pressed (`shortcut`) or let
 * go (`shortcutrelease`).
 *
 * Its own type rather than a DomicileAppEvent with the combination in the
 * `title` slot. A shortcut is not a window's name and does not belong to a
 * window at all: it fires whatever holds the keyboard, which is the point of
 * grabbing it.
 */
export type DomicileShortcutEvent = Event & {
  /**
   * The chord as the shell grabbed it -- `Meta+Shift+l` -- or empty for one
   * grabbed as a keycode. See DomicileHost.grabShortcut().
   */
  readonly chord: string;
  /** The Linux evdev code, the same numbering key() forwards in. */
  readonly keycode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
};

/**
 * One icon in the system tray.
 *
 * An interface rather than a dictionary for DomicileClipboardEntry's reason:
 * WebIDL will not have a dictionary as the element type of an attribute's
 * array, and these are read off DomicileHost.tray.
 */
export type DomicileTrayItem = {
  /**
   * What DomicileHost.activateTrayItem() names this icon by: the bus name the
   * application answers on and the object path it answers at, written together.
   */
  readonly id: string;
  /**
   * What the icon is, in words: its tooltip's title, its title, or its id, the
   * first the application said. Never empty.
   */
  readonly title: string;
  /**
   * The picture, as a `data:` URL to draw, or empty for one the compositor
   * could not draw. A URL rather than a path: the page may draw what the
   * compositor read and cannot read it.
   */
  readonly icon: string;
};

/**
 * One client window on the desktop, as `DomicileHost.windows` lists it: what
 * the compositor has said about it so far. Replaced, never edited: a change to
 * any window is a new `windows` array and a `windowschanged` event.
 */
export type DomicileWindow = {
  readonly appId: string;
  /** Empty until the client names itself. */
  readonly title: string;
  /**
   * The size the client last committed, in CSS pixels; null until it has
   * committed one.
   */
  readonly width: number | null;
  readonly height: number | null;
  /** The limits the client asked for; null where it asked for none. */
  readonly minWidth: number | null;
  readonly minHeight: number | null;
  readonly maxWidth: number | null;
  readonly maxHeight: number | null;
  readonly cursor: DomicileCursorShape;
  /**
   * A popup's parent window and its place relative to it, and whether it
   * grabbed the pointer; null and false for a toplevel.
   */
  readonly parent: string | null;
  readonly x: number | null;
  readonly y: number | null;
  readonly grab: boolean;
};
