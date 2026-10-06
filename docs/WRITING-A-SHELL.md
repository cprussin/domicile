# Writing a shell

A **shell** is a Domicile desktop's UI: panels, window decorations, launcher,
wallpaper. It is a built web page. Domicile ships two shells (`manganese` and
`simple`); neither is special. This guide covers writing one in its own
repository.

- [`examples/minimal-shell`](/examples/minimal-shell) is the worked example.
  [`scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh)
  builds it against the published SDK on every `./scripts/check.sh shell`. If
  this guide and the example disagree, the example is right.
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
- **perspective:** clicks land in the wrong place on an `<app>` under
  `perspective` or a `perspective()` transform. The SDK logs a warning. Other
  transforms work.

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

## The connection

```ts
const domicile = window.domicile;
if (domicile === null || domicile === undefined) {
  return; // a plain browser: no desktop
}
```

- `window.domicile` is the control channel the engine adds to the page. Its
  type is `DomicileHost`, from `@domicile-desktop/sdk/domicile-host`. There is
  nothing to configure. `navigator.domicile` is the same object.
- There is nothing to await and no version handshake. The browser process
  checks the protocol version and logs a mismatch. The first call binds the
  channel.
- State is attributes: `windows`, `focusedWindow`, `displays`, `theme`,
  `locked`, `idle`, `extensions`, `tray`, `notifications`, `browserWindows`
  and more. Each change dispatches a bare `<name>changed` event.
  `audiochanged`, `batterychanged` and `modifierschanged` each cover a group.
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
  effect misses none. `audiolevels` is not held.
- `searchFiles`, `previewFile` and `searchApps` return promises. A newer call
  rejects the older with an `AbortError`.
- A plain browser has no `window.domicile`, and `<app>` is an
  `HTMLUnknownElement` there: it takes a box and shows nothing. Develop
  against a real desktop.

**Errors:** log to the console. Page logs reach the terminal Domicile started
from. Invalid calls (an empty argv, a keycode of zero, a malformed chord)
throw, because they are bugs in the page.

## The SDK

`@domicile-desktop/sdk`, on npm, provides:

- `DomicileHost` (the type of `window.domicile`) and `Shell`
- `registerElements` (input routing over your `<app>` elements)
- `focusApp`, `focusChrome`, `bindKeys`
- `windowOf`, `surfaceSizeOf` (questions about `domicile.windows`)
- `FakeDomicileHost` (`./fake-host`), a `window.domicile` for your tests
- types and event names for `<app>` and `<webview>`

`window.domicile` is the API; the SDK is its types plus helpers. The IDL is in
`packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
`registerElements` is the one helper a shell needs: it forwards the pointer
and keyboard to clients until the engine does.

**Tests:** hand `FakeDomicileHost`'s `host` to your shell. `set` changes
attributes and dispatches their change events, `appear`, `change` and `close`
edit `windows`, `dispatch` fires a moment, and `calls` records every method
the shell called.

`@domicile-desktop/component-library` is the React and Panda CSS design
system this repo's shells use. Shells do not need it.

## The smallest shell

```ts
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

export const Shell: ShellModule = (root) => {
  const domicile = window.domicile;
  if (domicile === null || domicile === undefined) {
    return;
  }
  registerElements(domicile);

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
- `root` is the empty `<body>`. Create your own container in it and render
  there. Errors are reported by appending to `root`, and a framework that owns
  `root` would wipe them.
- There is no `#root` element. `document.getElementById("root")` returns
  `null`, and the only symptom is a white window.
- Make the background transparent wherever a window should show. A background
  painted over an `<app>` hides it.
- Set `document.title` if you want a title other than Domicile's.

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
- The SDK routes clicks on it to its window (`windowOf`, from
  `@domicile-desktop/sdk/windows`).
- The compositor closes a menu when the keyboard leaves its window.
- A popup placed near a screen edge is not moved back on screen.

## Windows

Each entry in `domicile.windows` describes one client window.

- **Cursor:** `cursor` is the CSS cursor a client wants over its window. Set it
  with `element.style.cursor = cursor` (in React, `<app style={{ cursor }}>`).
- **Size:** the `<app>` element's layout box is the window size. The engine
  sends it to the client. Resize a window by styling its element.
- **Drawn size:** `width` and `height` are the size the client drew at, `null`
  until it draws. The SDK already uses them for pointer mapping
  (`surfaceSizeOf`), so you only need them for your own UI (`shell-simple`
  uses them to remove a placeholder).
- **Limits:** `minWidth`, `minHeight`, `maxWidth` and `maxHeight` give the
  client's limits (`null` for none). Outside them, the client's frame is cut
  off or stretched. `shell-manganese` keeps floating windows within them.
- **Multiple monitors:** the page spans every monitor, so a window across two
  monitors is one `<app>`, and dragging across the edge is one drag.

## Who gets the keyboard

The compositor delivers keys, but your shell decides where they go. With no
handling, a click focuses the window under it and a client's focus request is
ignored.

### A click on a window

The SDK fires a cancelable, bubbling `domicile-focus-requested`
(`APP_FOCUS_REQUESTED_EVENT`) on the clicked `<app>`. Unhandled, it focuses
that client. To apply your own policy:

```ts
import type { AppFocusRequest } from "@domicile-desktop/sdk/app-element";
import { APP_FOCUS_REQUESTED_EVENT } from "@domicile-desktop/sdk/app-element";
import { focusApp } from "@domicile-desktop/sdk/focus-app";

document.addEventListener(APP_FOCUS_REQUESTED_EVENT, (event) => {
  const { appId } = (event as CustomEvent<AppFocusRequest>).detail;
  event.preventDefault();
  if (myPolicySays(appId)) {
    focusApp(domicile, appId);
  }
});
```

Use `focusApp(domicile, id)`, not `domicile.focusApp(id)`. Key events go to
`document`, and the SDK forwards them to the focused client. `focusApp` tells
both the compositor and the SDK. `domicile.focusApp` tells only the
compositor, so keystrokes stay in the page.

### Taking the keyboard for your own UI

Something always holds the keyboard. It leaves a window when another window
takes it, when a click lands on the shell's own UI, or when you call:

```ts
import { focusChrome } from "@domicile-desktop/sdk/focus-chrome";

focusChrome(domicile);
```

- Call it when you open a panel to type into (launcher, switcher, palette).
  Otherwise the window underneath keeps receiving the keystrokes.
- As with `focusApp`, use the SDK function, not `domicile.focusChrome()`.
- Give focus back from whatever normally assigns it. In `shell-manganese`, an
  effect in `AppWindow` asks for the keyboard whenever it is elsewhere, which
  also restores it when a panel closes.

### A click on your window decorations

The SDK treats a press outside every `<app>` as the page taking the keyboard.
That is wrong for a title bar or drag handle you drew for a window. Before
taking it, the SDK fires a cancelable `domicile-focus-release-requested` on the
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
compositor does not grant it. Call `focusApp(domicile, event.appId)` to grant
it, or ignore it.

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

Call `domicile.setAppBounds(appId, { x, y, width, height })` with each
`<app>`'s box in page pixels whenever it moves or resizes. The client draws at
the scale of the monitor holding most of the box. A window you never report
draws for the densest monitor. `shell-manganese` reports from `AppWindow`.

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
- It returns `{ setMode, unbind }`. `setMode` keeps one mode across a desktop
  of several pages.
- Command meanings are yours. Document them in your README, as
  [manganese does](/packages/shell-manganese/README.md). Manganese takes keys
  from `runManganese({ keybindings })`, defaulting to sway's.
- Grabs are never released, so a key bound in any mode is taken from every
  client for the session. Design:
  [KEYBINDINGS.md](/docs/architecture/KEYBINDINGS.md).

## The configuration

The user describes the desktop (displays, keyboard, idle, lock, theme,
extensions) in one config file. The compositor reloads it on every change. See
[SHELL-CONFIG.md](SHELL-CONFIG.md).

- The shell owns any other user-facing settings: its own location, schema and
  names.
- `@domicile-desktop/sdk` does not parse the config. Its schema is the
  `domicile-config` crate's, and there is no TypeScript parser for it.
