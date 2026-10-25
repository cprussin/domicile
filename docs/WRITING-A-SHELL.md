# Writing a shell

A **shell** is a Domicile desktop's UI: panels, window decorations, launcher,
wallpaper. It is a built web page. Domicile ships two shells (`manganese` and
`simple`); neither is special. This guide covers writing one in its own
repository.

- [`examples/minimal-shell`](/examples/minimal-shell) is the worked example.
  It pins the SDK published from a `stable` commit and runs on that commit.
  [`scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh)
  builds it against the packed SDK on every `./scripts/check.sh shell`;
  [`example-shell-from-npm.sh`](/.github/scripts/example-shell-from-npm.sh)
  builds it from npm. If this guide and the example disagree, the example is
  right.
- To contribute to Domicile itself, see [`/AGENTS.md`](/AGENTS.md).

More:

- [SHELL-CONFIG.md](SHELL-CONFIG.md): the config file that describes a
  desktop.
- [SHELL-BROWSER-WINDOWS.md](SHELL-BROWSER-WINDOWS.md): browser windows
  (`<webview>`) and `browserWindows`.
- [SHELL-EXTENSIONS.md](SHELL-EXTENSIONS.md): Chrome extensions' toolbar
  buttons and popups.
- [SHELL-DESKTOP-EVENTS.md](SHELL-DESKTOP-EVENTS.md): displays, theme, system
  tray and notifications.
- [SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md): blanking and the lock
  screen.
- [SHELL-PACKAGING.md](SHELL-PACKAGING.md): bundling and distributing a shell.

## What a shell is

A JavaScript module whose `Shell` export is a function.

- Domicile serves the module, imports it into a page it writes, and calls
  `Shell` with the element to draw in.
- Only `Shell` is read; other exports are ignored. A config module's settings
  exports do not apply when it is loaded as a shell.
- Importing the module may only install its stylesheet. A config module is
  also imported under Bun, which has no DOM, so all DOM work goes in `Shell`.
- If the module fails to load, has no `Shell`, or `Shell` throws, the page
  shows the error.
- The page draws nothing until `Shell` returns, so draw your first frame
  before it does. With React, mount with `flushSync`. A shell that draws later
  fades in from an empty white page.
- The contract is framework-agnostic. `runManganese` is manganese's React
  adapter.
- Each Wayland window becomes an `<app>` element in your page. Where you put
  the element is where the window is. Placing windows is the shell's job.
- The compositor handles clients, input, outputs and pixels.

`<app>` and `<webview>` are tags built into the engine (Domicile's Chromium
fork). Nothing registers them. Write them as you would a `<div>`. `<webview>`
is a browser page; see [SHELL-BROWSER-WINDOWS.md](SHELL-BROWSER-WINDOWS.md).

Style an `<app>` like a `<div>`. A window is a layer in your page's layer
tree, so CSS applies to it directly. `z-index`, `transform`, `border-radius`,
`opacity`, `filter: blur()` and `mix-blend-mode` render bit-exact against an
ordinary element ([measurements](/docs/architecture/ENGINE-FORK-MEASUREMENTS.md)).
Exceptions:

- A client that draws in shared memory instead of on the GPU shows a blank
  window.
- `backdrop-filter` over an `<app>` renders but is not pixel-verified; see
  [WINDOW-COMPOSITING.md](/docs/architecture/WINDOW-COMPOSITING.md).

## Running it

```sh
nix run github:cprussin/domicile/stable -- ./my-desktop/dist/shell.js
```

- The module path is the whole interface. Name the file what you like.
- Domicile serves the directory the module is in, over `domicile://`.

**Dev loop:** run `vite build --watch` next to `domicile ./dist/shell.js`.
Nothing reloads automatically (the page runs under `--app`, with no reload
button). To load a rebuilt bundle, run `domicile load-shell ./dist/shell.js`
in a terminal inside the desktop. Any shell works, and windows stay put
([THE-DOMICILE-BINARY.md](/docs/architecture/THE-DOMICILE-BINARY.md)).

**If your page's renderer dies,** the engine ends with a FATAL line saying
so, and the supervisor starts it again. That is a bug in Domicile, not
your shell's to handle: report it with the log
([THE-DOMICILE-BINARY.md](/docs/architecture/THE-DOMICILE-BINARY.md#crashes-are-recovered)).
Your own script errors are yours: catch them with `try`/`catch`,
`window.onerror` and `unhandledrejection`. A `<webview>` whose page dies
tells you instead
([Crashed pages](SHELL-BROWSER-WINDOWS.md#crashed-pages)).

## The connection

```ts
export const Shell: ShellModule = (root, domicile) => {
  // `domicile` is the desktop
};
```

- `domicile`, the second argument to `Shell`, is the control channel to the
  compositor. Its type is `DomicileHost`, from
  `@domicile-desktop/sdk/domicile-host`. There is nothing to configure.
- It is the only copy. The engine runs your module and calls `Shell` with
  the desktop; there is no `navigator.domicile` or `window.domicile`. Keep it
  however you like (a React context, a variable) and pass it to what needs
  it.
- There is nothing to await and no version handshake. The browser process
  checks the protocol version and logs a mismatch. The first call binds the
  channel.
- State is attributes: `windows`, `focusedWindow`, `displays`, `theme`,
  `locked`, `idle`, `extensions`, `tray`, `notifications`, `browserWindows`
  and more. Each change dispatches a bare `<name>changed` event.
  `modifierschanged` covers a group.
  Read, then listen:

  ```ts
  const show = () => draw(domicile.displays);
  show();
  domicile.addEventListener("displayschanged", show);
  ```

- An attribute is `null` until the compositor has sent it; `windows` starts
  empty.
- Moments (`focusrequested`, `shortcut`) are events. The engine holds each
  type until its first listener exists, so a listener added in React's first
  effect misses none.
- `searchFiles` returns a promise. A newer call rejects the older with an
  `AbortError`.
- Only Domicile calls a shell, so there is no plain-browser case to check
  for. Develop against a real desktop.

**Errors:** log to the console. Page logs reach the terminal Domicile started
from. Invalid calls (an empty argv, a keycode of zero, a malformed chord)
throw, because they are bugs in the page.

## The SDK

`@domicile-desktop/sdk`, on npm, provides:

- `DomicileHost` (the type of the desktop `Shell` is handed) and `Shell`
- `bindKeys`
- `FakeDomicileHost` (`./fake-host`), a desktop for your tests
- types and event names for `<app>` and `<webview>`

Versions are `0.0.0-alpha-<sha>`, one per `main` commit, under the `next`
dist-tag; there is no semver release yet. Depend on the exact version whose `<sha>` matches the Domicile commit
you run, as the example does.

The desktop `Shell` is handed is the API; the SDK is its types plus helpers.
The IDL is in
`packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
The engine routes the pointer and keyboard over an `<app>` to its client, in
the client's own coordinates through every CSS transform, so no helper is
required.

**Tests:** hand `FakeDomicileHost`'s `host` to your shell. `set` changes
attributes and dispatches their change events, `appear`, `change` and `close`
edit `windows`, `dispatch` fires a moment, and `calls` records every method
the shell called.

`@domicile-desktop/component-library` is the React and Panda CSS design
system this repo's shells use. Shells do not need it.

## The smallest shell

```ts
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

export const Shell: ShellModule = (root, domicile) => {
  const mounted = new Map<string, HTMLElement>();

  const show = () => {
    const windows = domicile.windows;
    for (const [appId, element] of mounted) {
      if (!windows.some((window) => window.appId === appId)) {
        element.remove();
        mounted.delete(appId);
      }
    }
    for (const { appId } of windows) {
      if (!mounted.has(appId)) {
        const element = document.createElement("app");
        element.setAttribute("app-id", appId);
        root.append(element);
        mounted.set(appId, element);
      }
    }
  };

  show();
  domicile.addEventListener("windowschanged", show);
};
```

This is a working desktop: every window full-screen, newest on top.

- Domicile imports the module and then calls `Shell` once. Do no work at
  import time except CSS. Other exports are ignored. A missing or throwing
  `Shell` is reported on screen.
- Remove the elements `windows` no longer lists, or every closed window leaks
  an element.
- Domicile writes the document: a charset, a viewport, and a `<body>` with no
  margin that fills the window. You cannot supply one.
- Only script files next to your module run: no inline scripts, `on…`
  attributes or `eval`. See
  [SHELL-PACKAGING.md](SHELL-PACKAGING.md#scripts).
- `root` is the empty `<body>`. Create your own container in it and render
  there. Errors are reported by appending to `root`, and a framework that owns
  `root` would wipe them.
- There is no `#root` element. `document.getElementById("root")` returns
  `null`, and the only symptom is a white window.
- Make the background transparent wherever a window should show. A background
  painted over an `<app>` hides it.
- Set `document.title` if you want a title other than Domicile's.
- This shell answers no portal requests, so an app's portal dialog, a bare
  `domicile screenshot` and `domicile screen-record` wait until the desktop
  exits. Answer or refuse them as
  `examples/minimal-shell` does; see [PORTALS.md](PORTALS.md).

### Popups

A client's menus and tooltips are entries in `windows` with `parent` set:

- `appId`: the popup's own id
- `parent`: the window or popup (for a submenu) it belongs to
- `x`, `y`: CSS pixels from the top-left of the parent's box; `width`,
  `height`: its size
- `grab`: `true` for a menu, `false` for a tooltip

To show one:

- Mount an `<app>` for it at that position, above its parent.
- Give it no frame and do not tile it. Draw it only where its window is drawn.
- Remove it when `windows` drops it.
- The engine routes a click on it to its window's keyboard.
- The compositor closes a menu when the keyboard leaves its window.
- A popup placed near a screen edge is not moved back on screen.

## Windows

Each entry in `domicile.windows` describes one client window.

- **Identity:** `appId` is the compositor's id for the window, which `<app>`
  takes. `desktopId` is the client's Wayland app id (`set_app_id`), which
  names its desktop entry, for example `org.gnome.Nautilus` for
  `org.gnome.Nautilus.desktop`. It is `""` until the client sets one. Look up
  the entry's `Icon=` to draw the app's icon.
- **Owner:** `pid`, `uid` and `gid` name the process that connected the
  window's client, as the kernel recorded it (`SO_PEERCRED`). The client
  cannot forge them; `title` and `desktopId` are its own claims.
  - `pidfdInode` is the inode of that process's pidfd. No other process gets it
    until reboot, so it tells a reused pid apart. `null` before Linux 6.9.
  - All of these are `null` for a popup; read its parent's.
  - A process inside a container has its pid in the compositor's pid
    namespace.
- **Sandbox:** `sandboxed` is `true` when the client connected through a
  sandbox engine's `wp_security_context_v1` listener. Such a client sees no
  data control or screen capture globals
  ([PORTALS.md](PORTALS.md#sandboxed-clients)).
  - `sandboxEngine`, `sandboxAppId` and `sandboxInstanceId` are what the
    engine said, for example `org.flatpak`, the Flatpak app id and its
    instance id. `null` where it said nothing.
  - They come from `wp_security_context_v1`, so they are claims by whichever
    client created the context. Any unsandboxed client can create one with
    any values.
  - `sandboxInstanceId` is passed through verbatim and is fixed for the
    client's life.
  - Don't base a security decision on them alone. Check them against `pid`,
    `uid` and `gid`, for example the pid plus its start time or
    `pidfdInode`.
- **Cursor:** `cursor` is the CSS cursor a client wants over its window. Set it
  with `element.style.cursor = cursor` (in React, `<app style={{ cursor }}>`).
- **Size:** the `<app>` element's layout box is the window size. The engine
  sends it to the client. Resize a window by styling its element. Set
  `resizing` on the element while the user drags an edge; see
  [ELEMENTS.md](/packages/chrome-sdk/docs/ELEMENTS.md).
- **On screen:** listed means drawn, not shown. Wait for
  `domicile-presented` on the `<app>` before revealing a window, for example
  to start an open animation. `domicile-suspended` and `domicile-resumed` say
  when its client stops and starts drawing. See
  [ELEMENTS.md](/packages/chrome-sdk/docs/ELEMENTS.md).
- **Listed when drawn:** a window joins `windows` with its first frame, so
  its title, `desktopId`, limits and hints are already set.
- **Drawn size:** `width` and `height` are the size the client drew at. The
  engine already uses them for pointer mapping, so you only need them for
  your own UI, such as sizing a dialog.
- **Dialogs:** `dialog` is `true` when the client gave the window a parent or
  a fixed size, as sway reads them. `shell-manganese` floats such a window at
  its drawn size. `dialog` is fixed at the first frame.
- **Parent:** `transientFor` is the `appId` of the window this one is a dialog
  for (`xdg_toplevel.set_parent`), or `null`. It follows every change. When the
  parent closes, it names the parent's own parent, as xdg-shell says.
- **Anchor:** `anchor` names the place in your page the client asked to be
  laid out at (`domicile_anchor_v1`), or is `null`. It follows every change.
  The names are yours to define. Lay the window's `<app>` out inside your
  anchor element and it moves with your layout in the same frame. Treat a
  name you have no anchor for as `null`. `shell-manganese` defines none.
  See [Anchored windows](architecture/WINDOW-COMPOSITING.md#anchored-windows).
- **Urgency:** `urgent` is `true` when the compositor dropped the window's
  focus request (see [A client asking for focus](#a-client-asking-for-focus))
  and the window has not had the keyboard since. It clears when the window gets
  the keyboard, and is never set on the window holding it. Draw it as an
  attention hint, such as a highlighted workspace or title.
- **Client frames:** `clientFrame` is `true` when the client asked to draw its
  own frame. `shell-manganese` leaves its title bar off such a window while it
  floats.
- **Synced frames:** `frame` is the frame to set as the window's
  `<app frame>`, in the same render as the change that came with it, such as
  a popup's move. Call `domicile.syncFrames()` once a page renders it: only
  then does the compositor sync frames. It lasts until the page loads again.
  An `<app>` with no `frame` shows the newest, so a shell that ignores frames
  needs neither. See
  [Synced frames](architecture/WINDOW-COMPOSITING.md#synced-frames).
- **Shortcut inhibitors:** `inhibitsShortcuts` is `true` while the client
  holds `zwp_keyboard_shortcuts_inhibitor_v1`, as a VM or remote desktop
  viewer does. A change fires `windowschanged`. See
  [Keybindings](#keybindings).
- **Limits:** `minWidth`, `minHeight`, `maxWidth` and `maxHeight` give the
  client's limits (`null` for none). Outside them, the client's frame is cut
  off or stretched. `shell-manganese` keeps floating windows within them.
- **Multiple monitors:** the page spans every monitor, so a window across two
  monitors is one `<app>`, and dragging across the edge is one drag.

### Window states

Tell a client how its window is laid out with its `xdg_toplevel` states:

```ts
import { system } from "@domicile-desktop/sdk/system";
import { WindowState } from "@domicile-desktop/sdk/window-state";

await system(domicile).setWindowStates(appId, [
  WindowState.TiledLeft,
  WindowState.TiledRight,
  WindowState.TiledTop,
  WindowState.TiledBottom,
]);
```

- **Tiled** states say something touches that edge. A client that draws its
  own frame then draws no shadow, rounded corners or resize border there.
- **`Maximized`** and **`Fullscreen`** tell the client it fills its box.
  They do not size the window; the `<app>` box does.
- Each call replaces the states the shell set and configures the client. The
  compositor's own states (`activated`, `suspended`) are kept.
- States outlive a shell reload. Set them again for every window you lay out;
  setting the same states configures nothing.
- A client bound below `xdg_wm_base` version 2 has no tiled states. Given any
  tiled state and no `Fullscreen`, it gets `maximized` instead, as in sway, so
  it drops its shadows and takes its box's size. A client asking to unmaximize
  stays maximized until the shell's states change.
- An unknown `appId` fails with `SystemErrorKind.NotFound`.

A client asks to be maximized or fullscreen (a terminal's fullscreen key, a
video player). The compositor answers with a configure of the states it has
and reports the request. Nothing changes until the shell sets states.

- `system(domicile).windowRequests()` streams each request as a
  `WindowRequest`: `Maximize`, `Unmaximize`, `Fullscreen` or `Unfullscreen`,
  with its `appId`. `Fullscreen` carries the `display` the client named, if
  any.
- A shell that does not listen ignores every request.

`shell-manganese` tiles with all four tiled states, sets none on floats, and
makes a window fullscreen while its client asks to be.

## Who gets the keyboard

The compositor delivers keys, but your shell decides where they go. With no
handling, a click focuses the window under it and a client's focus request is
ignored.

### A click on a window

The engine fires a cancelable, bubbling `domicile-focus-requested`
(`APP_FOCUS_REQUESTED_EVENT`) on the clicked `<app>`. Unhandled, it focuses
that client. A popup's press asks for its window. A `preventDefault()` on the
`pointerdown` itself takes the whole press: the client gets none of it and
nothing is asked. To apply your own policy:

```ts
import type { AppFocusRequest } from "@domicile-desktop/sdk/app-element";
import { APP_FOCUS_REQUESTED_EVENT } from "@domicile-desktop/sdk/app-element";

document.addEventListener(APP_FOCUS_REQUESTED_EVENT, (event) => {
  const { appId } = (event as CustomEvent<AppFocusRequest>).detail;
  event.preventDefault();
  if (myPolicySays(appId)) {
    domicile.focusApp(appId);
  }
});
```

Key events go to `document`, and the engine forwards them to the focused
client. `domicile.focusApp` moves both the compositor's seat and where the
page's keys go.

### Taking the keyboard for your own UI

Something always holds the keyboard. It leaves a window when another window
takes it, when a click lands on the shell's own UI, or when you call:

```ts
domicile.focusChrome();
```

- Call it when you open a panel to type into (launcher, switcher, palette).
  Otherwise the window underneath keeps receiving the keystrokes.
- Give focus back from whatever normally assigns it. In `shell-manganese`, an
  effect in `AppWindow` asks for the keyboard whenever it is elsewhere, which
  also restores it when a panel closes.

### A click on your window decorations

The engine treats a press outside every `<app>` as the page taking the
keyboard. That is wrong for a title bar or drag handle you drew for a window.
Before taking it, the engine fires a cancelable `domicile-focus-release-requested` on the
`<app>` that holds the keyboard. Cancel it to keep focus on the window:

```ts
import type { AppFocusReleaseRequest } from "@domicile-desktop/sdk/app-element";
import { APP_FOCUS_RELEASE_REQUESTED_EVENT } from "@domicile-desktop/sdk/app-element";

document.addEventListener(APP_FOCUS_RELEASE_REQUESTED_EVENT, (event) => {
  const { appId, pressed } = (event as CustomEvent<AppFocusReleaseRequest>)
    .detail;
  if (isChromeFor(appId, pressed)) {
    event.preventDefault();
  }
});
```

`shell-manganese` tags each floating window's bar and drag sheet with its
window and checks that here.

**JSX:** `<app>` has no hyphen, so React treats it as a plain HTML element and
ignores unknown `on…` props. Bind these events with `addEventListener` on a
ref. The same applies to `<webview>` events.

### A client asking for focus

The `focusrequested` event, with the window's `appId`, is `xdg-activation`: an
app asking to come forward (for example, a browser asked to open a link). The
compositor does not grant it. Call `domicile.focusApp(event.appId)` to grant
it, or ignore it.

Only requests made since the keyboard last moved arrive. The compositor drops a
token whose serial is older than the keyboard's last `enter`, or has none: that
is a window taking focus back on its own, not something the user did. Such a
window is marked `urgent` instead.

A request that arrives is the shell's to decide, so the compositor marks no
window `urgent` for it: ignoring a request is silent, and the compositor cannot
tell it apart from a grant still on its way. A shell that ignores one and wants
it shown keeps its own mark.

The compositor mints its own tokens for what the user does in the shell:
`spawn` (as `XDG_ACTIVATION_TOKEN`) and a notification press (as
`ActivationToken`). So a singleton app launched again, or an app whose
notification was pressed, asks with `focusrequested`. Only the newest such
token is good, for 10 seconds.

### Where focus is

`domicile.focusedWindow` is the client that holds the keyboard, `null` while
the page holds it; `focusedwindowchanged` reports changes. Use it, not your
own idea of the active window, to know where keys go. If a focused client
crashes, the compositor gives the keyboard to the page; `windows` drops the
window first, so you can focus another.

### Focus follows the mouse

If focus follows the pointer, a keyboard focus change can be undone at once:
the old window is still under the pointer. Move the pointer with
`domicile.warpPointer(x, y)`, in page coordinates (`clientX`/`clientY`).

- Points outside the page are clamped.
- In a nested run inside another compositor, nothing moves.
- `shell-manganese` warps on its own focus changes (keyboard-driven, or a new
  window taking focus) when the pointer is not already over the window.

### Window scale on several monitors

Call `domicile.setAppBounds(appId, x, y, width, height)` with each
`<app>`'s box in page pixels whenever it moves or resizes. The client draws at
the scale of the monitor holding most of the box. A window you never report
draws for the densest monitor. `shell-manganese` reports from `AppWindow`.

Report a window you hide (`display: none`, another workspace) as
`setAppBounds(appId, 0, 0, 0, 0)`. Its client then draws about once a second:
the compositor holds its frame callbacks and marks it `suspended` until you
report a box again. A window being cast draws on. A theme change does not wait
for it. A new page starts with every window shown.

## Keybindings

A shell's keys come from its own props. Each chord maps to a shell command or a
binding mode, like sway:

```ts
import { bindKeys } from "@domicile-desktop/sdk/bind-keys";
import { KeyAction } from "@domicile-desktop/sdk/key-action";

bindKeys(
  domicile,
  {
    keybindings: {
      "Meta+l": KeyAction.SendShell(["focus", "right"]),
      "Meta+r": KeyAction.Mode("resize"),
    },
    modes: {
      resize: {
        "Meta+l": KeyAction.SendShell(["grow", "right"]),
        "Meta+Escape": KeyAction.Mode("default"),
      },
    },
  },
  {
    onCommand: (args) => run(args),        // ["focus", "right"]
    onModeChanged: (mode) => show(mode),   // "resize", "default"
  },
);
```

- A chord is modifiers (`Meta`, `Shift`, `Ctrl`, `Alt`) plus an xkb keysym
  name, joined by `+`.
- The engine finds the key each keysym is on in the configured layout, so
  `Meta+parenleft` works on any layout and follows layout changes.
- A malformed chord throws before anything is grabbed. A keysym the keyboard
  cannot type is logged, and the other keys still work.
- `bindKeys` grabs every chord by name (`domicile.grabShortcut`), handles each
  `shortcut` event by its `chord` whether the press landed on the page or in a
  `<webview>`, handles `Mode` itself, and passes every `SendShell` to
  `onCommand`.
- `domicile send-shell <word>…` from a terminal reaches `onCommand` too, on
  every page bound. A page that cannot listen calls `report`, which logs by
  default.
- It returns `{ setMode, unbind }`. `setMode` keeps one mode across a desktop
  of several pages.
- Command meanings are yours. Document them in your README, as
  [manganese does](/packages/shell-manganese/README.md). Manganese takes keys
  from `runManganese({ keybindings })`, defaulting to sway's.
- While bound, a key bound in any mode is taken from every client. `unbind`
  gives the chords back (`domicile.ungrabShortcut`). Each `grabShortcut` needs
  its own `ungrabShortcut`.
- A window with `inhibitsShortcuts` gets grabbed chords as keys while it has
  the keyboard; no `shortcut` fires. Let keys through in your own listeners
  too. Design: [KEYBINDINGS.md](/docs/architecture/KEYBINDINGS.md).

## The configuration

The user describes the desktop (displays, keyboard, idle, lock, theme,
extensions) in one config file. The compositor reloads it on every change. See
[SHELL-CONFIG.md](SHELL-CONFIG.md).

- Settings of your own shell go in `shell_options`; see [Options](#options).
- The shell owns any other user-facing settings: its own location, schema and
  names.
- `@domicile-desktop/sdk` does not parse the config. Its schema is the
  `domicile-config` crate's, and there is no TypeScript parser for it.

## Options

Options are settings a user changes without editing the shell's code. Declare
them, and the user sets them under `shell_options` in the config or on the
Settings app's **Shell** page ([SETTINGS.md](SETTINGS.md)).

```ts
import { defineOptions, option } from "@domicile-desktop/sdk/options";

export const options = defineOptions({
  clock: {
    format: option.choice("Clock format", ["24h", "12h"], "24h"),
    seconds: option.toggle("Show seconds", true),
  },
  gaps: option.number("Gap between windows", 8, { max: 64, min: 0 }),
});
```

```json
{ "shell_options": { "clock": { "format": "12h" }, "gaps": 4 } }
```

- Kinds: `toggle`, `choice`, `number` (with an optional `min` and `max`),
  `text` and `list` (of text). A plain object is a group. Each option has a
  label and a default. `defineOptions` throws on a default that its own
  choices or limits refuse.
- Export it from the shell's entry as `options`. The builder writes it to
  `options.json` beside `shell.js`. A prebuilt shell passes it to `shellBuild`
  (`@domicile-desktop/component-library/vite-shell`). A shell with no
  `options` export has no options.
- `watchShellOptions(domicile, options, listener)` calls `listener` with the
  values now and on every change. A change needs no rebuild or reload.
  manganese's React hook is `useShellOptions`
  (`@domicile-desktop/manganese-host/useShellOptions`).
- An option the config leaves out takes its default. An unknown key or a bad
  value is dropped and logged, so the shell starts whatever the file says.
- The Settings app refuses to write a value the declaration refuses. A config
  module that computes `shell_options` is read-only in the form, like its other
  settings.
- Arguments in code win over options. Say in your docs which arguments
  shadow which options; the form cannot see them.
- On the wire: the compositor sends the JSON text in `shell_config`, and the
  engine exposes it as `domicile.shellOptions` with a `shelloptionschanged`
  event ([CONTROL-CHANNEL.md](/packages/domicile-engine/docs/CONTROL-CHANNEL.md)).

Key decisions:

- **Values in JSON over rewriting code.** A JSON key can be written safely; a
  call's arguments cannot.
- **A declaration over reading prop types.** Types are gone at run time, and a
  form needs labels, defaults and limits.
- **One opaque key over a section per shell.** The compositor's schema stays
  closed and does not change when a shell adds an option.
- **Drop bad values in the shell; refuse them in the host.** The shell must
  start whatever the file says; the app should never write a bad value.
