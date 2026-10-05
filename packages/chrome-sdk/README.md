# @domicile-desktop/sdk

> Published to npm, and usable outside this repo. If you are writing a shell,
> start with [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md) — this is the
> reference for the package, that is the guide to using it.
>
> It ships built JavaScript and `.d.ts` from `dist/`, not the TypeScript in
> `src/`: run `bun run build` before anything outside the workspace resolves it.

The in-page half of Domicile. A Domicile chrome is ordinary web content; it
talks to the compositor through the `DomicileHost` the forked engine hands its
`Shell`, and mounts real Wayland clients as `<app>` elements.
This package is the TypeScript for that surface plus helpers around it.

It provides these:

- **`DomicileHost`** (`./domicile-host`) — the type of the desktop a shell is handed,
  mirroring the engine's IDL. State is readonly attributes (`windows`,
  `focusedWindow`, `displays`, `theme`, `locked`, `idle`, `extensions`,
  `tray`, `notifications`, …), each with a bare `<name>changed` event: read,
  then listen, and a late listener misses nothing. Moments are events —
  `focusrequested`, `openurl`, `shortcut` — and the engine holds each type
  until its first listener exists; `audiolevels` is not held. `searchFiles`,
  `previewFile` and `searchApps` return promises, and a newer call rejects the
  older with an `AbortError`. `openurl` is not the compositor's: it is an
  address `domicile open-url` asked the desktop to open — what `BROWSER` runs
  inside it — and opening it is the shell's.
- **`Shell`** (`./shell`) — the type of a shell module's `Shell` export: what
  Domicile calls, once, with the element to draw in and the desktop. The
  engine makes the desktop for the call, so there is no global: a
  shell keeps it however it likes (a React context, a variable) and passes it
  on. A module without one is
  refused on the screen.
- **`<app>`** (`./app-element`) — the tag name, the two focus events, and the
  TypeScript for the element, which is the fork's. The surface embed and the size
  a client is configured at are both the layout box's and the engine reports
  them, and the engine sends the client the pointer and wheel over it, mapped
  through the element's whole transform into the client's own surface
  coordinates, and the page's keys while it has the keyboard; there is nothing
  to call. A press on a window fires a cancelable `domicile-focus-requested`
  (`detail.appId`, a popup's window rather than the popup) and then focuses the
  client; a press off every window fires a cancelable
  `domicile-focus-release-requested` (`detail.appId`, `detail.pressed`) on the
  window that holds the keyboard and then hands it back to the page. A shell
  that wants focus to be its own decision calls `preventDefault()` on either;
  one that calls it on the `pointerdown` itself has taken the press, and the
  client hears none of it. `domicile.focusApp(appId)` and
  `domicile.focusChrome()` move the keyboard without a click, both in the
  compositor's seat and for the keys this page hears. A right-click over a
  window loses the browser's menu: the menu it asked for is the client's.
- **`<webview>`** (`./webview-element`) — types and event names only. The
  element is the engine's: `src` is the address it loads, `goBack` /
  `goForward` / `stop` / `reload` are what a chrome's address bar drives it
  with, `canGoBack` / `canGoForward` say whether the first two would do
  anything, `loading` says whether a page is still arriving, and `focus` puts
  the keyboard on the embedded page. What this module adds is the TypeScript
  for all of that plus the names of the four events the browser process
  dispatches on it, `domicile-guest-focus`, `domicile-history-change`,
  `domicile-loading-change` and `domicile-new-window`. The last is the only one
  that carries anything — `event.url`, the address a link with
  `target="_blank"` asked to open — because it is the only one that is not about
  state the element already holds: the browser process opens no window for a
  guest, so a shell that ignores it is a desktop where such a link does
  nothing.
  `domicile-close` is the page calling `window.close()` — an extension's popup
  closing itself — and removing the view is the shell's answer. A view opened
  for an extension's action popup carries `extensionpopup` from its first
  render, which makes its page a popup, as Chrome's toolbar bubble is, and no
  tab.
  `domicile-content-size-change` says `contentWidth` / `contentHeight` moved:
  the size the page's content wants, which Chrome sizes an extension's popup
  from.
  `domicile-popup-window` is an extension's `chrome.windows.create` with a
  popup: `windowId`, `url`, `width` and `height` (0 where it named none). The
  shell opens a window whose view carries `popupwindow="<windowId>"` from its
  first render — the engine reads it once, as the view is connected — and that
  view is then the extension's window.
- **`bindKeys`** (`./bind-keys`) — a shell's own keys, grabbed and answered:
  `bindKeys(domicile, { keybindings, modes }, { onCommand, onModeChanged })`,
  each table a chord (`"Meta+Shift+l"`) to a `KeyAction`. It grabs every chord
  of every mode by name with `domicile.grabShortcut`, once each — the engine
  finds the key each keysym is on, again whenever the layout moves — and
  answers each `shortcut` event by its `chord` in the current mode. A
  `KeyAction.SendShell(words)` calls `onCommand(words)`, whose meaning is the
  shell's; `KeyAction.Mode(name)` is answered here, and `onModeChanged` says
  the mode moved. It returns `{ unbind, setMode }`: `setMode` is how a desktop
  of several pages keeps one mode across them (one the shell lacks goes back
  to `default`). A chord written wrong throws before anything is grabbed; a
  keysym the keyboard cannot type is logged. Grabs are never given back.
  `./own-keybindings` is the grammar only (one spelling per chord, filed by
  mode) and `./key-action` the action a binding carries.
- **`FakeDomicileHost`** (`./fake-host`) — a desktop for a shell's
  tests. `host` is what the shell is handed; `set` changes attributes and
  dispatches each `<name>changed` they owe; `appear`, `change` and `close` edit
  `windows`; `dispatch` fires a moment (`shortcut`, `openurl`,
  `focusrequested`); `calls` records every method the shell called. The asks
  return promises that never settle.
- **Shapes a shell reshapes rows into** — `Extension` (`./extension`),
  `TrayItem` and `TrayAction` (`./tray`), `Notification` (`./notification`),
  `./audio` and `./file-preview`. The engine's own rows are
  `DomicileExtension`, `DomicileTrayItem`, `DomicileNotification` and the rest
  in `./domicile-host`. A tray click is `domicile.activateTrayItem(id,
  action)`; an extension's is `domicile.activateExtension(id)`, which grants it
  `activeTab`, and one with a `popup` is then a `<webview>` at that address. A
  notification's press is `domicile.invokeNotificationAction(id, key)`, a clear
  `domicile.dismissNotifications(ids)`.
- **Pure helpers** — `./cursor-shape` for the keyword set a client can ask
  for, `./theme` and `./display-transform`.

The compositor's own JSON wire is not here: a page never speaks it. Its
schemas and framing live in
[`@domicile-desktop/e2e-harness`](../e2e-harness/README.md), the headless
stand-in for a chrome that talks to the compositor's socket directly.

## Usage

```ts
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

export const Shell: ShellModule = (root, domicile) => {
  const show = () => {
    // Render `domicile.windows` as `<app app-id="…">` elements into `root`.
  };
  show();
  domicile.addEventListener("windowschanged", show);
};
```

That is the whole of it. There is nothing to await and no setup call: the
compositor's protocol version is checked in the browser process and only
logged, the engine reports the page's size and density itself and routes the
input over an `<app>`, and the first call on the channel is what binds it.

Only Domicile calls a shell, so there is no plain-browser case to handle.
Develop against the real desktop (`./scripts/dev-shell.sh <shell>` in this
repo).

Then render `<app app-id="…">` / `<webview src="…">` as normal DOM and style
them with ordinary CSS — rounding, blur, transforms, and z-index all apply to the
live client surface. That is the whole point of Domicile.

Both tags are the fork's own HTML elements, so there is nothing to register and
nothing here to wrap them in — a custom element's name must contain a hyphen, per
spec, which is exactly why they are the engine's. Note what that costs in a React
chrome: a tag without a hyphen is an ordinary HTML element to React, so it writes
no unrecognized property and binds no `on…` prop for an event it has not heard
of. Bind the events on a ref.

### Knowing which modifiers are held

**Read them off your own key events.** The desktop is the chrome's window, so
the page hears every key the user presses whatever the compositor's seat is
pointed at — that is how the engine forwards a keystroke to a client in the
first place:

```ts
const follow = (event: KeyboardEvent) => {
  // While Alt is held, let the pointer reach the page rather than the window
  // it is over: `pointer-events: none` is what tells the compositor the
  // window is not taking clicks, and it hit-tests accordingly.
  portal.style.pointerEvents = event.altKey ? "none" : "";
};
document.addEventListener("keydown", follow);
document.addEventListener("keyup", follow);
```

**Not off the host's `altKey` / `ctrlKey` / `shiftKey` / `metaKey`, today.**
They report the compositor's seat, and the seat only knows the keys this page
forwarded to it — which is only the keys pressed while a client held the
keyboard. A modifier pressed while the chrome held it never reaches the seat,
and the next forwarded key makes the attributes deny it: a shell that believed
them over its own keystrokes read a held Alt as let go of. They are still
kept, and are what will say so on the day the compositor reads input itself
rather than being handed it by this page; they cannot know more than this page
until then.

## Dependencies

`zod`, for the schemas this package exports — `./cursor-shape`, `./theme`,
`./display-transform`, `./extension`, `./tray`, `./notification` and
`./file-preview` — which a shell parses what the desktop hands it with.
Not because the engine fails to check it — `DomicileWindow.cursor` is a WebIDL
`enum` over the same closed set as `./cursor-shape` — but because this package
and the engine are published apart. A shape this list has and the running
engine does not arrives as a keyword no `DomicileCursorShape` names, and an
unknown keyword assigned to `style.cursor` fails silently.

Nothing else. `@cprussin/option-result` was a dependency for exactly one
outcome — `connect()` returning `Result<number, HandshakeFailure>` — and there
is no handshake to fail. Everything here either throws (a bug, per
[ERRORS.md](/docs/guidelines/ERRORS.md)) or returns `T | undefined` for
ordinary absence.

## Test

```sh
bun run turbo test --filter @domicile-desktop/sdk
```

DOM-dependent suites run against happy-dom via
[`@domicile-desktop/test-support`](../test-support/README.md).
happy-dom has never heard of `<app>`, so it creates one as an
`HTMLUnknownElement`, which React's development build reports on the console as
an unrecognized tag. It cannot happen on the fork, where the tag is
`HTMLAppElement`; React exempts `dialog` and `webview` from that report by name
and there is no way to add a third.
