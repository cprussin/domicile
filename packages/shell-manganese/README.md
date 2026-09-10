# @domicile/shell-manganese

The bundled reference chrome: a rail carrying a tab per open window, the
launchers, the theme toggle and a clock, beside a stage that shows one window at
a time. It is the app Domicile ships to prove the model end to end — every pixel
of it is ordinary web content, and each Wayland client on the stage is a real
`<domicile-app>` element that takes ordinary CSS.

The chrome is a React tree built entirely from
[`@domicile/component-library`](../component-library/README.md): the
rail is its `TabRail`, the launchers and a browser window's controls are its
`Button`, the address bar its `Input`, the empty stage its `Card` and `Kbd`, the
theme toggle its `ThemeSwitch`. Styling is Panda CSS from the library's preset —
the shell defines no stylesheet of its own.

The page is the whole desktop, however many displays that is. The chrome goes on
the first display the config names — the names are the user's, so the shell
cannot pick one — and every other display gets a clock, which is what makes a
screen the config describes visibly there. Nothing is drawn until a desktop has
been described, which is the handshake's worth of blank window: a chrome laid
out over the page and then moved onto a screen is a different element in that
slot, and React would take every open window down with it. Opened in a plain
browser for styling work there is no host to describe one, so the shell
describes the window itself. A host that describes a desktop with *no* screens
is a third thing again — there is nowhere to lay the chrome out — and the page
says so rather than staying blank.

A window is either a Wayland client the host announced or a browser window the
shell opened itself; both get a tab, and the rail is what switches between them.
Only the window on the stage has a box, so the SDK reports the rest to the host
as no longer composited. The window that takes the stage takes the keyboard with
it, so what the user just opened or switched to is typeable without a click: a
client's keyboard goes to the host, a browser window's to its page.

## Layout

| Path | What |
|---|---|
| `src/renderer.tsx` | Renderer entry: applies the theme, builds the `BridgeClient`, registers the SDK's custom elements, mounts `<Shell>`, prints the diagnostics line. |
| `src/Shell.tsx` | The chrome: the rail, the launchers, the stage, the keybindings, and which screen each of them is on. |
| `src/display-source.ts` | The `BridgeClient` as the component library's `DisplaySource`, which is the whole of what joins the two. |
| `src/viewport-display.ts` | The same, for a shell with no host: the window is the only display there is. |
| `src/mount-point.ts` | Where the chrome mounts. Its own file because Domicile writes the document, so there is no element to look up — the shell makes one. |
| `src/useShellWindows.ts` | Wires host events and user actions into the reducer, and the host's window events into the portal elements. |
| `src/shell-state.ts` | Every change the window list can undergo, as one pure reduction. |
| `src/shell-window.ts` | The window model: a client's portal or a browser window. |
| `src/float.ts` | A window that has left the rail: where it sits on the stage and how big. Its own module because floating is not a kind of window. |
| `src/useFloatDrag.ts`, `src/FloatGrab.tsx`, `src/FloatTitleBar.tsx` | Dragging and resizing a floating window, and the furniture that offers it. |
| `src/claim-pointer.ts` | Where the chrome takes the pointer *over* a window — the compositor hit-tests the window's box and knows nothing about what the page painted on top of it. |
| `src/useModifiers.ts` | The modifiers the shell reacts to. |
| `src/app-elements.ts` | The live `<domicile-app>` elements by app id — where resizes and cursors are applied. |
| `src/AppWindow.tsx` | A Wayland client's window: one `<domicile-app>` portal. |
| `src/BrowserWindow.tsx` | A browser window: an address bar (back / forward / stop / reload) over a `<domicile-webview>`. |
| `src/with-scheme.ts` | What an address typed without one gets: `example.com` is an address, not a relative path. |
| `src/Clock.tsx` | The live clock: in the rail's footer, and alone on every display the rail is not on. |
| `src/diagnostic-lines.ts` | What the chrome has to say about its own timings — the keystroke round trip, and placement. |
| `src/window-styles.ts` | What every window on the stage shares. |
| `src/global.css`, `src/css.d.ts` | The document-level styling, and the type for importing it. |
| `src/domicile-elements.d.ts` | The SDK's custom elements, as JSX. |

There is no main process and no preload. The engine is the display compositor
and the page opens a WebSocket to the bridge serving it, so what is here is the
chrome and nothing else.

React owns this DOM, so the chrome writes `<domicile-app>` in JSX rather than
letting the SDK's `aliasTag` upgrade a short `<app>` tag — a MutationObserver
that swaps nodes out from under the reconciler is not something React tolerates.
`aliasTag` remains in the SDK for chromes that build their DOM themselves.

## Launching windows

- **Terminal** in the rail footer, or **Alt+Enter** — ask the compositor to
  spawn a terminal (`kitty`) onto Domicile.
- **+** in the rail header, or **Alt+Shift+Enter** — open a browser window on
  the stage. Its address bar navigates on Enter (an address typed without a
  scheme is loaded over https) and follows the page wherever it goes; the
  window's tab is labelled with the site it is showing.
- **Alt+Tab** — float the window you are working in, or put it back.
  **Alt+drag** moves a floating window; **Alt+Shift+drag** resizes it. See
  below.

## Floating a window

**Alt+Tab** takes the window you are working in out of the rail, where it
floats over the stage in a box of its own; pressing it again puts the window
back. Each float opens cascaded past the ones already out, and comes to the
front when you click it or pick its tab.

**A browser window comes to the front from a click anywhere in it**, its
address bar and its page alike, and the two halves say so differently. The
chrome sends the shell a pointer event like any other page furniture. The page
does not: it is a guest with a browsing context of its own, so nothing about a
pointer inside it ever crosses back out — a click there used to leave the
window under whatever was covering it, while the rail went on highlighting the
window before it and the keyboard stayed there too. What does cross is the
focus that click takes, on the element the guest hangs off in the chrome's own
document. So the window listens for both, and either one brings it to the front
and makes it the window everything keyed acts on. A client's window needs none
of this: the compositor moves the keyboard onto it and says so
(`focus_changed`), and the shell follows.

The float order is the stacking order, and the shell writes it as the
`z-index` of the window's *own* element — which is what stacks the window,
because the window is a layer in this page's own layer tree, and what the SDK
reports with the placement so the compositor hit-tests in the same order. A floating window
is drawn over the stage rather than on it, so the stage falls back to the last
window still in the rail rather than going blank.

A floating window has a **title bar**: what it is called, and an X that closes
it. Dragging the bar moves the window, with no modifier held — the bar is
chrome, so the pointer over it belongs to the page, which is exactly what is
not true of the rest of the window. The bar comes *out* of the window's box
rather than being added to it, so a window dragged to a size is that size, bar
included, and a resize does not have to reason about a frame that grows with
it.

**And the bar claims the pointer where it lies.** Being drawn in the right
place is only half of it: the compositor hit-tests rectangles, it knows where
every window is because the page reports each `<domicile-app>` element's box,
and it knows nothing about what the page painted over one. A bar lies across
whatever the window it names cascades over, so without a claim the press on it
goes to *that* window — which focuses it, which raises it. Clicking the front
window's title bar raised the one behind it, and the bar never heard the click.
`pointer-events: none` on the window is the other half of the same mechanism
and cannot answer this: it makes a whole window inert, which is right for a
menu drawn across all of it and wrong for a bar covering the top thirty pixels
of one window and none of the window beside it. So the shell says where it
takes the pointer, at what depth, and the compositor gives the press to
whichever is on top there. See `claim-pointer`.

**This shell paints no desktop background of its own.** A background element
would go behind every window and fill in the holes the clients show through — a
desktop of windows hidden behind their own wallpaper. The background is the
host's: `html, body { background: transparent }`.

A floating window's corners are the frame's rather than its own, and square:
the compositor's shader takes one radius for all four (it is the element's
`border-top-left-radius` the SDK reports), so a window cannot be square under
its bar and round at the bottom. The bar carries the rounding.

**Alt+drag** moves a floating window and **Alt+Shift+drag** resizes it from the
bottom-right corner. Which of the two a drag is, is read when it starts and
then kept, so letting go of Shift half way through does not turn a resize into
a move with the window jumping to wherever the pointer got to. A window is
never dragged smaller than the grab it is dragged by, and its top-left corner
stays on the stage — the two edges a window dragged past could not be dragged
back from.

Two things have to be true for that drag to be seen at all, and both are worth
knowing about:

- **The pointer over a window belongs to the client behind it.** That is the
  point of Domicile, and it means the shell cannot handle a drag on the window
  itself. While Alt is held a floating window is given
  `pointer-events: none` — the compositor reports it as taking no pointer and
  routes to the chrome instead — and a transparent sheet over the window
  catches what falls through. The same mechanism that stops a window
  swallowing the clicks meant for a menu drawn over it.
- **The page cannot see Alt while a window has the keyboard.**
  `wl_keyboard.modifiers` goes to the focused surface, so the compositor
  broadcasts the held set instead and the shell listens (`modifiers`). The
  page's own keyboard events are the fallback for a shell opened in a plain
  browser with no host to ask.

The window is **half transparent while it is being dragged**, and that
translucency is the compositor's rather than the page's: the SDK reports the
element's `opacity` with the placement and the shader applies it to the
client's own buffer, so what shows through a dragged window is the desktop
behind it.

A floated window keeps its tab. The tab is how it is reached when it is behind
something, and a window with no tab and nothing selected is a window you have
lost — so picking the tab of a floating window brings it to the front rather
than putting it back on the stage. Alt+Tab is what changes the mode.

Both combinations are claimed twice over, because two different things can be
holding the keyboard when the user presses one. The page listens for its own
`keydown`, which is what answers when the shell itself has focus — including
over a `<domicile-app>`, whose pixels are a portal element in this document.
And `grabShortcut` claims the combination for the desktop, which is what
answers when a window has it: the compositor takes it before a Wayland client
is given it, and the browser process takes it before a browser window's page
is — a `<domicile-webview>` is a browsing context of its own, so a key pressed
on a site the shell is showing reaches neither this page nor the compositor,
and the layer inside the engine is the only one above it. One ask, honoured
wherever the keyboard happens to be; exactly one path fires for any press.

A tab reorders by drag, or by Alt+Up / Alt+Shift+Up (and their Down
counterparts) on a focused row. Every tab closes its window — by its X, or by a
middle-click anywhere on the row. A browser window goes at once, because the
shell owns it; a client's window is the client's, so the X *asks* it to close —
a terminal exits, an editor with unsaved work is free to put a dialog up and
stay. That tab leaves the rail when the host says the client actually went
(`app_closed`), not when the close is asked for.

## Configure

`$XDG_CONFIG_HOME/domicile/manganese.json`, and nothing of Domicile's: this
shell owns the file, and what the compositor needs is derived from it.

```json
{
  "present": true,
  "desktop": {
    "displays": [{ "name": "left", "size": [1920, 1080] }],
    "keyboard": { "layout": "us", "variant": "dvp", "options": ["caps:swapescape"] }
  }
}
```

Everything is optional; a missing file is a first run rather than a mistake.
`keyboard` is the exception worth knowing about: unset, this desktop comes up
on Programmer's Dvorak with Caps Lock and Escape swapped, which is a preference
rather than a neutral default. Naming one replaces it whole rather than merging
into it — a variant belongs to a layout, so `{ "layout": "de" }` is a German
keyboard and not a German one with `dvp` still under it. For an ordinary US
layout, say so: `{ "layout": "us" }`.

## Build & run

```sh
bun run turbo build:vite --filter @domicile/shell-manganese
```

emits the chrome to `.vite/renderer/main_window/`, which is the whole of what a
shell builds: a page and what it loads.

```sh
nix run 'github:cprussin/domicile#manganese'
```

runs it — the bridge, the engine on that page, and the compositor as a producer
to it. `./scripts/dev-shell.sh manganese` does the same from a checkout.

`bun run --filter @domicile/shell-manganese start:dev` runs this shell in a real
desktop and rebuilds it as you edit: the engine the flake pins, the compositor
and the bridge built out of this checkout, and the page reloading itself when
vite finishes a build.

`styled-system/` is Panda's generated output, produced by `bun run prepare`
(run automatically as a turbo dependency of the build, type check, and tests)
and not checked in.

## Test

```sh
bun run --filter @domicile/shell-manganese test
```

runs the type check, the unit tests, and the Vite build. The components render
against happy-dom via
[`@domicile/test-support`](../test-support/README.md).
