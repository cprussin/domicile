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
| `src/renderer.tsx` | Renderer entry: applies the theme, builds the `BridgeClient`, registers the SDK's custom elements, mounts `<Shell>`, reports the frame timing. |
| `src/Shell.tsx` | The chrome: the rail, the launchers, the stage, the keybindings, and which screen each of them is on. |
| `src/display-source.ts` | The `BridgeClient` as the component library's `DisplaySource`, which is the whole of what joins the two. |
| `src/viewport-display.ts` | The same, for a shell with no host: the window is the only display there is. |
| `src/desktop-size.ts` | How big the desktop the displays make up is: the bounding box, gaps included. |
| `src/useWindowSizedToDesktop.ts` | Keeping the window that size, which is the main process's to do. |
| `src/useShellWindows.ts` | Wires host events and user actions into the reducer, and the host's frames into the portal elements. |
| `src/shell-state.ts` | Every change the window list can undergo, as one pure reduction. |
| `src/shell-window.ts` | The window model: a client's portal or a browser window. |
| `src/app-elements.ts` | The live `<domicile-app>` elements by app id — where frames, resizes and cursors are applied. |
| `src/AppWindow.tsx` | A Wayland client's window: one `<domicile-app>` portal. |
| `src/BrowserWindow.tsx` | A browser window: an address bar (back / forward / stop / reload) over a `<domicile-webview>`. |
| `src/Clock.tsx` | The live clock: in the rail's footer, and alone on every display the rail is not on. |
| `src/window-styles.ts` | What every window on the stage shares. |
| `src/main.ts` | Electron main process: opens the window, takes the chrome's own key combinations out of the pages it embeds, sizes it to the desktop, and prints and exits on the renderer's behalf. |
| `src/preload.ts` | Opens the compositor connection, exposes it to the page as `window.domicileHost`, and hands the page what it asks of its Electron host: a line on a terminal, the window's size, a way to say why it stopped, and the keys a `<webview>` would swallow. |
| `src/handshake-failure.ts` | What a refused handshake costs the shell, seen from the page — the same conclusion a dead socket reaches in the host package. |
| `src/size-to-desktop.ts` | The main process's half of `useWindowSizedToDesktop`: it resizes on its own page's ask and nobody else's. |
| `src/guest-shortcuts.ts` | The combinations the page claimed from a `<webview>`, which delivers its keys to nobody else. |
| `src/chord.ts` | A key combination as a page names its keys — what the shortcut channels carry. |
| `src/shortcut-channels.ts` | The channel names main and preload agree on for a claimed combination. |
| `src/diagnostic-channel.ts` | The channel a timing line reaches a terminal on. |
| `src/desktop-size-channel.ts` | The channel the page asks for its window's size on. |
| `src/domicile-elements.d.ts` | The SDK's custom elements, as JSX. |

Electron is the prototype's host: it renders the chrome as a visible, testable
window today. The eventual target embeds CEF directly, at which point `main.ts`
and `preload.ts` are replaced by the engine integration and everything under
`src/` that is not Electron-specific carries over unchanged. What those two
share with every other shell in the tree — the window itself, where the
compositor socket is, what a dead one costs, the channel a renderer cannot
serve itself — comes from
[`@domicile/electron-chrome-host`](../electron-chrome-host/README.md); what is
here is what only this chrome needs.

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

The float order is the stacking order, and the shell writes it as the
`z-index` of the window's *own* element — which is what the SDK reports with
the placement and what the compositor stacks the client's surface by, so the
page and the desktop agree about which window is in front. A floating window
is drawn over the stage rather than on it, so the stage falls back to the last
window still in the rail rather than going blank.

A floating window has a **title bar**: what it is called, and an X that closes
it. Dragging the bar moves the window, with no modifier held — the bar is
chrome, so the pointer over it belongs to the page, which is exactly what is
not true of the rest of the window. The bar comes *out* of the window's box
rather than being added to it, so a window dragged to a size is that size, bar
included, and a resize does not have to reason about a frame that grows with
it.

The bar is also why this shell declares depths at all. It is page pixels at the
depth of the window it names, so a window in front of that one has to be drawn
*over* it — and a compositor that composites the whole page above every window
cannot do that. So the shell tells it where its own layers are: one band under
every floating window (the backdrop, the rail, whatever is on the stage), and
one per float above it. Nothing floating declares nothing, because a desktop
with nothing to interleave would pay a round trip per repaint for a picture the
compositor already has.

Rendering a band means leaving only that band painting, and three things follow
from that being a whole-page property rather than a component's:

- **It happens outside React.** What the page commits next *is* the raster, and
  `setState` schedules — the commit would carry whatever was on screen before
  React got to it. So the elements carry a `data-band` attribute and `bands.ts`
  drives them directly.
- **`opacity`, not `visibility` or `display`.** The page stays in the last band
  it was asked for; nothing puts it back, because putting it back is a repaint
  and a repaint is another round trip. A hidden element takes no pointer, so
  the chrome would be dead to the mouse between cycles, and one with no box
  would move every window. At `opacity: 0` an element lays out as it did, takes
  the pointer as it did, and paints nothing. What you look at is the bands
  composited, not the page.
- **Everything that paints is in exactly one band.** Anything unmarked paints
  in *every* band, which is only ever right for something that paints nothing:
  a `<domicile-app>` portal is a hole in the page, and fading one would report
  it to the compositor at `opacity: 0` and take the window off the screen.

  Which is also why **this shell paints no desktop background of its own**. On
  the composited path a background element goes behind every window and fills
  in the holes the clients show through — a desktop of windows hidden behind
  their own wallpaper. The background is the host's, injected per path:
  `html, body { background: transparent }` where Domicile composites this
  window, and the page's own where it does not.

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

Both combinations are claimed three times over, because three different things
can be holding the keyboard when the user presses one. The page listens for its
own `keydown`; the compositor is asked to take the combination before a Wayland
client is given it (`grab_shortcut`); and the Electron host is asked to take it
before an embedded page is — a `<webview>` is a browsing context of its own, so
the keys pressed on a site the shell is showing reach neither the page nor, on
the copy path, Domicile. Exactly one of the three fires for any press.

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

emits the Electron main bundle to `.vite/build/main.js`, the preload to
`.vite/build/preload.cjs`, and the chrome to
`.vite/renderer/main_window/`. `package.json`'s `main` points at the built
bundle, so with a compositor running:

```sh
electron packages/shell-manganese
```

opens the chrome against it. `./scripts/run-native.sh` does the whole dance
(compositor + chrome) from the repo root.

`bun run --filter @domicile/shell-manganese start:dev` serves the renderer alone on
Vite's dev server, for styling work without a compositor: `renderer.tsx` falls
back to a no-op transport when the host injects none. A browser window's page
stays blank there — `<webview>` is Electron's tag — but the rail, the tabs, and
the address bar are all live.

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
