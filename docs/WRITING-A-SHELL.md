# Writing a shell

A **shell** is a Domicile desktop: the panels, the window decorations, the
launcher, the wallpaper. Domicile ships two (`manganese` and `simple`), but
neither is special. A shell is a built web page in its own repository, and this
describes how to write one.

This is a guide, not a guideline: nothing here governs contributions to this
repo. For that see [`/AGENTS.md`](/AGENTS.md).

Everything below is worked end to end in
[`examples/minimal-shell`](/examples/minimal-shell), which lives outside the
bun workspace and is built against the *published* SDK by
[`scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh) on
every run of `./scripts/check.sh shell`. If this document and that example
disagree, the example is right — it is the one that is checked.

## What a shell is

A built web page. Domicile serves it, loads it in the engine, and runs the
compositor underneath; a Wayland client that maps a window becomes an `<app>`
element in your page, and where you put that element is where the window is.
Deciding that — and nothing else — is a shell's whole job. The compositor keeps
the clients, the input, the outputs and the pixels.

`<app>` and `<webview>` are the **engine's own tags**, not the SDK's. Nothing
registers them and nothing can: a custom element's name must contain a hyphen,
per spec, which is exactly why the fork defines these two as real HTML elements.
Write them as you write a `<div>`. `<app>` is a client's window and is most of
what follows; `<webview>` is a page, and has
[a section of its own](#a-browser-window).

**And style them as you style a `<div>`**, which is the whole point of the
thing. A window is a `cc::SurfaceLayer` in your page's own layer tree, so the
page's compositor applies CSS to it because it applies CSS to a layer — not
because anyone reimplemented a property. `z-index`, `transform`,
`border-radius`, `opacity`, `filter: blur()` and `mix-blend-mode` are each
measured bit-exact against an ordinary element laid out beside it, on a GPU,
and a submitted frame reaches the screen in one display frame
([the measurements](/docs/architecture/ENGINE-FORK.md)). Two things are not
promised: a client that draws in shared memory rather than on the GPU gets a
blank window, and a `backdrop-filter` over an `<app>` should work and has not
been run — [WINDOW-COMPOSITING.md](/docs/architecture/WINDOW-COMPOSITING.md)
keeps that list.

```sh
nix run github:cprussin/domicile -- ./my-desktop/dist/shell.js
```

That is the entire interface between a shell and Domicile: one built
JavaScript module, named on the command line. Call it what you like — Domicile
loads the file it was given, and the directory that file is in is what it
serves. **Domicile writes the document** — you do not ship one, and there is
no way to supply your own.

Domicile owns the window, the socket and the process. What is left for a
shell to be is the page.

So there is no launcher to write, no `bin/` stub, no session to read out of the
environment, and nothing to install. There are two processes at run time and
neither of them is yours:

| Process | What it does |
|---|---|
| the **engine** | the fork. It serves your page over `domicile://` and loads it, and it is the display compositor |
| the **compositor** | a producer to the engine: it keeps the Wayland clients and hands their buffers over |

The order is forced and Domicile forces it: the engine first, because the
compositor connects to the socket it creates. Your page is served over
`domicile://` rather than opened off disk because `file:` has no origin, and
the channel to the compositor is `window.domicile` rather than a socket the
page opens, because a page cannot open a Unix socket and nothing here binds a
port.

## The connection

One call, and it is the whole of the wiring:

```ts
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";

const domicile = new DomicileClient(connectToHost(window));
```

`connectToHost` reads `window.domicile`, which is the control channel the
engine puts on a document it served. There is nothing to configure and nothing
to pass: it is a property of the page, so no query string carries a socket path
and no two things can disagree about where the compositor is.

`navigator.domicile` is the same object and keeps working — the engine hangs
one host off the window and answers both spellings with it, so a listener bound
through either is bound to the one channel. Write `window.domicile`: system
state is reached at `window.domicile.<interface>` with nothing to register
first, and that is the surface the rest of this guide names.

A page with no compositor gets a stand-in that does nothing, so the layout
still lays out, and `connectToHost` says once, on the console, that there was no
compositor to find and so no window will ever appear. That one line covers the
elements as well: the thing that defines `<app>` is the thing that binds
`window.domicile`, so a page with an `<app>` that can never show a window is
exactly the page this warned about. There an `<app>` is an
`HTMLUnknownElement` — it takes a box and shows nothing, and the SDK routes
pointers over it as usual. Ask `hasHost(window)` if you need the question
answered in your own code; do not reconstruct it.

Do not develop against that, though: it is the chrome with every window in it
missing, and a desktop's interesting behavior is all on the other side of the
channel. Point `domicile` at your shell's module and let your own bundler watch
it — `vite build --watch` beside `domicile ./dist/shell.js` is the whole dev
loop, and it is a real desktop rather than a page pretending to be one.
**Nothing reloads it**: a desktop runs under `--app`, where there is no reload
to press, so a rebuilt bundle needs the desktop restarted until
`domicile load-shell` lands
([why](/docs/architecture/THE-DOMICILE-BINARY.md)).

## There is nothing to await

**A shell does nothing about versions, and waits for nothing.** The channel is
a typed surface rather than a message pipe: the compositor's protocol version
is checked in the browser process, which logs a disagreement and carries on,
and a page has no part in it. Say what you have to say as soon as you have a
client, and the first call is what binds the channel.

What a shell *does* have to think about is registration order, and
`DomicileClient` is what handles it: it registers its own listeners in its
constructor and holds anything that arrives before your `on` does. A React
shell registers in its first effect flush, tens of milliseconds late, and every
window already running is announced before then.

**So never call `addEventListener` on `window.domicile` yourself.** It
works, and it works for everything dispatched after your listener existed —
which on a desktop with no clients open is everything, which is what makes the
bug invisible until somebody reloads with a terminal running.

The desktop is not an event at all: `domicile.displays` reads it whenever you
ask, so a component that mounts long after the compositor described one still
gets it. `domicile.on("displays", …)` is for reacting to a change, not for
learning what is there.

## Reporting a failure

Say it on the console: what a page logs reaches the terminal Domicile was
started from.

There is no way for a page to stop the desktop, and it does not need one. What
a shell can still get wrong is calling the compositor something it will not
accept — an empty argv, a keycode of zero, a device pixel ratio that is not
positive — and those *throw*, from the call, because they are bugs in the page
rather than outcomes it has to handle.

## The configuration

**The shell owns whatever a user edits.** Domicile has no user-facing
configuration beyond the one file below: your location, your schema, your
names.

The compositor takes a `--config` naming a TOML file that describes the
desktop — the displays, their layout, the keyboard — and watches it for
changes while it runs. **`domicile` passes one on:**

```
domicile --config ./desk.toml ./my-desktop/dist/shell.js
```

**And finds one when you leave the flag off:**
`$XDG_CONFIG_HOME/domicile/domicile.toml`, or `~/.config/domicile/domicile.toml`
where that is unset. A person who has written their monitors down should not
have to type where — and a shell packaged as a wrapper script does not have to
invent a location for a file that already has one.

That is the one well-known path in the whole system, and it is the `domicile`
binary's rather than the compositor's: `domicile-compositor` still takes every
value on its command line and reads nothing from the environment, because it is
started by a program. What is guessed here is guessed for a *person*, and the
run says which of the four answers it got before it starts anything:

```
config: /home/you/.config/domicile/domicile.toml, found where a config lives
config: ./desk.toml, because --config names it
config: none -- no /home/you/.config/domicile/domicile.toml -- so the compositor's defaults
```

The flag may come on either side of the shell, and no file at all is a real
answer rather than a missing one — a desktop with no monitors written down
runs a single output that follows the engine's own window, which is what a
nested developer run wants. What is refused is the half-stated form: a
`--config` with nothing behind it, or two of them, because the compositor
runs its defaults on a missing file and refuses a path it cannot load, and
guessing between those picks one for somebody who meant the other.

**The keyboard is one of the things a shell owns, and it is not optional in
the way it looks.** `input.keyboard` takes the `xkb_*` fields sway names —
`xkb_layout`, `xkb_variant`, `xkb_options` and the rest — and a config that
says nothing about them gets a plain `us`: no variant, no remapped keys. That
default is deliberately *nobody's* keyboard. It was one author's for a while
(Programmer's Dvorak with Caps Lock and Escape swapped), which is a surprise
nothing else in a desktop can produce — every key wrong, and no message
anywhere saying why. So a shell whose users do not type US QWERTY has to carry
their layout into this file; there is no layer below it that will.

Two of the things it can say about a desktop are different in kind, and which
one a shell generates depends on whether there is hardware under it:

- `output.displays` **states a desktop outright** — a name, a size, a position,
  a scale per display. A nested run has no monitors to enumerate, so this is
  the desktop, and nothing overrules it.
- `output.profiles` **places the monitors that are actually plugged in**. Each
  profile names exactly the displays it is for and says what to do with each
  one (`enabled`, `position`, a fractional `scale`, a `transform`); the first
  profile whose set is connected wins, and the match is made again on every
  hotplug and every reload. A display may be named either way round: by its
  `wl_output` name, which on a tty is `drm-<id>`, or by its *description* —
  `"<MAKE> <MODEL> <SERIAL>"` off the panel's EDID, which is the string kanshi
  and sway match on and the one a person can write down. Both survive being
  unplugged; the description is empty for a monitor that states none of the
  three.

```toml
[[output.profiles]]
name = "desk"

  [[output.profiles.displays]]
  display = "drm-1"
  enabled = false

  [[output.profiles.displays]]
  display = "DEL DELL U3219Q 2ZLS413"
  position = [0, 0]
  scale = 1.2
  transform = "rotate-270"

[[output.profiles]]
name = "laptop-only"

  [[output.profiles.displays]]
  display = "drm-1"
  scale = 1.5
```

**TOML rather than JSON, and it used to be JSON.** The argument for JSON was
that nobody writes this by hand — a shell generates it, and a generated file
wants a writer that cannot get the escaping wrong rather than a syntax that is
pleasant to type. That was about the writer, and there are two ends: a desk
comes up in the wrong arrangement and somebody opens this file to find out
why. A desk of six monitors and five profiles is a wall of braces to read one
`transform` out of, and `[[output.profiles]]` says which profile a display
belongs to on the line the display is on. The writer lost nothing — every
language that generates one of these has a TOML writer too.

**A monitor a profile turns is drawn turned.** Not by the scanout, which the
compositor still does not reach: a rotated panel scans out exactly as it did
lying down. It is the *page* that turns, and on a tty that is the same thing —
the engine opens one browser window per CRTC, so a page is one monitor and
covering it is a CSS `transform` on the region.

`<Screen>` does that for you and a shell writes nothing. What a display
carries for it is `mode`, `transform` and `fills_the_window`: the pixels the
panel scans out (un-turned — a 4K panel on its side is a 3840×2160 mode and an
1800×3200 box), which way up it is, and whether this page is that monitor. The
last is what turns the first two from description into an instruction, and it
is false for every desktop your window is the whole of.

The same arithmetic is what makes a display of a density your page does not
render at come out the right size, so a 1.2 monitor no longer draws its
desktop in the corner of a black screen.

**`transform` names the turn the *content* takes**, which is the `wl_output`
convention and the config file's: `rotate-90` is a quarter turn clockwise, for
an output bolted a quarter turn anticlockwise. A shell reading it applies it as
written.

`@domicile/chrome-sdk` does not parse that file. Its schema is the
`domicile-config` crate's, and there is no published TypeScript parser for it
today.

## The SDK

One package, published to npm and usable outside this repo:

| Package | What |
|---|---|
| `@domicile/chrome-sdk` | `DomicileClient` (the control channel), `connectToHost` (finding it), `registerElements` (the input and size routing over your `<app>` elements), `focusApp`, and the pure helpers around them. `<app>` and `<webview>` are the engine's own tags: the SDK types them and names the events on them, and registers nothing. |

It is not required. A shell may drive `window.domicile` itself — it is a
typed surface rather than a wire, described in
`@domicile/chrome-sdk/domicile-host` and, definitively, in the IDL under
`packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`.
Doing so means handling the registration order above yourself, along with the
input mapping and the size reporting that `registerElements` does.

`@domicile/component-library` is **not** part of the contract. It is the React
and Panda CSS design system this repo's own shells are built from, and it exists
to serve them. A shell outside this repo needs none of it — the example uses no
React at all.

## The smallest shell that works

One source file and a build config. The full version, with the comments, is in
[`examples/minimal-shell`](/examples/minimal-shell).

**`src/index.ts`** — the page, and the whole of the shell's behavior:

```ts
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const domicile = new DomicileClient(connectToHost(window));
registerElements(domicile);

const mounted = new Map<string, HTMLElement>();

domicile.on("app_appeared", ({ app_id }) => {
  const element = document.createElement("app");
  element.setAttribute("app-id", app_id);
  document.body.append(element);
  mounted.set(app_id, element);
});

domicile.on("app_closed", ({ app_id }) => {
  mounted.get(app_id)?.remove();
  mounted.delete(app_id);
});
```

That is a working desktop: every window full-screen, newest on top. A real
shell differs from it only in where it puts the elements.

`app_closed` is in there rather than left out because without it every window
leaks an element. Two things the snippet leaves out and the example does in
full:

- its `app_closed` *throws* on an app it never mounted, because a close for
  something never announced means the page and the compositor disagree about
  what is on screen;
- it calls `reportDevicePixelRatio(domicile, window)` from
  `@domicile/chrome-sdk/device-pixel-ratio`. The page is the only part of
  Domicile that can see the display's density — it changes when the window
  moves display or the page zooms — and a compositor never told it has every
  client drawing at the wrong resolution, blurry or oversized, with nothing
  said.

There is no document to write. **Domicile writes it**: a charset, a
viewport, and a `<body>` that fills the window with no margin. That last one is
not a nicety — eight pixels of default body margin is eight pixels the
compositor believes it has and does not, and a client's window drawn eight
pixels out looks like the seam rather than like a stylesheet.

**Nothing else, and in particular no element to mount into.** The body and the
script tag that loads you are the whole of it, so a shell that renders into a
container makes its own — `document.body.append` on the first line, as the
example above does. Stated this bluntly because the failure is silent: a shell
that looks up a mount point gets `null` and throws before it renders anything,
and under `--app` there is no console to read, so the whole failure is a white
window. It has cost a desktop here once already.

What is left to you is the background: make it transparent wherever an app
shows through, because an `<app>` is a hole in your page and a background
painted over it hides the very window it is meant to show.

The title is Domicile's until you say otherwise with `document.title`. It does
not guess — the directory a module came out of is as likely to be `dist` as
anything a person would recognize.

## What a window has to be told

**One thing, and it is CSS.** A client can ask for a cursor to be shown while
the pointer is over its window, and that reaches you as `app_cursor`:

```ts
domicile.on("app_cursor", ({ app_id, cursor }) => {
  const element = mounted.get(app_id);
  if (element !== undefined) {
    element.style.cursor = cursor;
  }
});
```

A window that is not there is not a mistake here, unlike on `app_closed` above:
the host drains what it was already sending for a client whose close you have
acted on.

That is all of it. The element is yours — you position it, size it, round it and
blur it — and its cursor is the same kind of act. A React shell writes
`<app style={{ cursor }}>` and is done.

**The size the client drew at is not yours to carry.** `app_resized` still
arrives, and you are welcome to it — `shell-simple` uses it to take a "nothing
here yet" placeholder down — but you do not have to route it anywhere: the SDK
records it off the channel as the message goes past, because scaling a pointer
position into the client's own pixels is the only use anyone has for it. A shell
that holds that size is a courier.

The element is the engine's, and it has no methods of its own for either of
these: a cursor is a style and a size is something the SDK already has.

## Who gets the keyboard

The compositor holds it — it is the only thing that can deliver a key — but
every move of it starts with your shell. Two questions reach you, and a shell
that answers neither is the desktop the smallest one above already is: a click
focuses the window under it, and a client that asks for focus is ignored.

**A click on a window** is the first. The SDK fires a cancelable
`domicile-focus-requested` on the `<app>` that was clicked
(`APP_FOCUS_REQUESTED_EVENT` from `@domicile/chrome-sdk/app-element`) and, left
alone, focuses the client — which is what you want when your shell has no
opinion. Call `preventDefault()` on it and nothing moves until you say so:

```ts
import type { AppFocusRequest } from "@domicile/chrome-sdk/app-element";
import { APP_FOCUS_REQUESTED_EVENT } from "@domicile/chrome-sdk/app-element";
import { focusApp } from "@domicile/chrome-sdk/focus-app";

document.addEventListener(APP_FOCUS_REQUESTED_EVENT, (event) => {
  const { appId } = (event as CustomEvent<AppFocusRequest>).detail;
  event.preventDefault();
  if (myPolicySays(appId)) {
    focusApp(domicile, appId);
  }
});
```

It bubbles, so one listener covers every window.

**`focusApp` rather than `domicile.focusApp`**, and the difference matters: the
client's method asks the compositor and stops there, while this also tells the
SDK where the page's keystrokes go. A key event is delivered to `document` and
never to an element — a Wayland client is a surface, with nowhere for the browser
to put focus — so both halves are needed, and calling only the first gives the
window the seat while every keystroke stays in the page.

It goes one way only. Which client holds the keyboard is one seat's answer and
something is always in it, so "this window has it" is an instruction the
compositor can carry out and "this window does not" is not one. The keyboard
leaves a window when another takes it or when a click lands on the chrome.

**A click on chrome you drew for a window** is the same question the other way
round, and it is the one a shell with window furniture has to answer. The SDK
reads a press that lands off every `<app>` as the page asking for the keyboard
back, which is right for a press on the desktop and wrong for a press on a
window's own title bar — or on the sheet an alt-drag is caught on. Those land
off every `<app>` too, and nothing in a press says which window a `<div>`
belongs to. So it asks, with a cancelable `domicile-focus-release-requested` on
the `<app>` that holds the keyboard:

```ts
import type { AppFocusReleaseRequest } from "@domicile/chrome-sdk/app-element";
import { APP_FOCUS_RELEASE_REQUESTED_EVENT } from "@domicile/chrome-sdk/app-element";

document.addEventListener(APP_FOCUS_RELEASE_REQUESTED_EVENT, (event) => {
  const { appId, pressed } = (event as CustomEvent<AppFocusReleaseRequest>)
    .detail;
  if (isChromeFor(appId, pressed)) {
    event.preventDefault();
  }
});
```

Left alone the keyboard goes back to the page, so a shell whose windows have no
chrome of their own needs to know nothing about this. `shell-manganese` marks
each float's bar and grab sheet with the window it belongs to and reads that
back here, which is how dragging a window no longer takes the keyboard off it.

**If you write JSX**, note that `<app>` has no hyphen in its name, so React
treats the tag as an ordinary HTML element: it writes neither a property it does
not recognize nor an `on…` prop for an event it has never heard of. Bind this
event with `addEventListener` on a ref. `<webview>`'s two events are the same.

**A client asking for focus** is the second, and it arrives as a message rather
than an event: `domicile.on("focus_requested", ({ app_id }) => …)`. This is
`xdg-activation` — "open this link in the browser I already have running", and
also the dialog that puts itself in front of what you were typing into. The
compositor does not grant it and makes no attempt to tell those two apart; it
passes the question on with the seat where it was. Answer with
`domicile.focusApp(app_id)`, or do nothing, which is a desktop where a background
window cannot take the keyboard.

**Where it actually is** comes back on `focus_changed`, which reports the
answer rather than asking anything. Your shell's idea of the active window and
the compositor's seat are two different facts, and this is the one that says
where the keys are going. It also arrives for the one move the compositor makes
on its own: a focused client that crashes hands the keyboard back to the page,
because a keyboard pointed at a surface that is gone is a desktop that has
stopped listening. That is a fallback and not a decision — the `app_closed` for
that window reaches you first, so a shell that would rather move to the next
window says so and has the last word.

## A browser window

`<webview src="…">` is the fork's other tag: a page in a browsing context of
its own, with the chrome around it yours to draw. A browser window in a shell
is an address bar over one of these, and that is all it is —
[`BrowserWindow.tsx`](/packages/shell-manganese/src/window-management/BrowserWindow.tsx)
is manganese's.

```ts
const view = document.createElement("webview");
view.src = "https://example.com";
document.body.append(view);

back.addEventListener("click", () => {
  view.goBack();
});
```

`goBack`, `goForward`, `stop` and `reload` are the element's own methods, and
so is `src` — reflected, so the attribute and the property are one value. Write
the *attribute* when you navigate: on a browser without the fork the property
is a value hung off an unknown element, and the DOM goes on reporting the
address the window opened at.

**Give it a size.** It is a replaced element with an intrinsic size, so a view
left to itself is 300×150 inside however large a window you put it in.

**It is a guest, not a frame.** The page inside has no ancestor, so a site
sending `X-Frame-Options: DENY` or `frame-ancestors 'none'` loads in one where
an `<iframe>` is refused. That boundary is also what the sections below are
about: nothing inside a guest — not a pointer event, not the focus a click
takes, not a keystroke — crosses back out into your page, so anything you want
to know, the element has to say.

### Back and forward

The element is the state and `domicile-history-change` is only a nudge: it
carries nothing, and what changed is `canGoBack` and `canGoForward` on the
element.

```ts
import { WEBVIEW_HISTORY_CHANGE_EVENT } from "@domicile/chrome-sdk/webview-element";

const readHistory = () => {
  back.disabled = !view.canGoBack;
  forward.disabled = !view.canGoForward;
};

readHistory();
view.addEventListener(WEBVIEW_HISTORY_CHANGE_EVENT, readHistory);
```

Reading on mount is the half that cannot be dropped. A React shell registers
its listeners in its first effect flush, tens of milliseconds after the guest's
first commit, so an address bar that only ever listened grays out a live
control until the user navigates again.

**Where the page actually went is not yours to know.** The engine reports
availability and nothing else, so a shell can show where it *sent* a window and
not where a link or a redirect then took it. There is no navigate event to
reach for — the SDK once synthesized one, it had fired for nothing since the
fork landed, and it was deleted rather than left looking available.

### A click in the page

You never see it. The guest has a browsing context of its own, so no pointer
event crosses out of it — and neither does the focus that click takes, because
Blink dispatches `focus` and `focusin` only while the page is focused, and a
guest taking focus is the moment your page loses it. So the element says so
itself, in an event that is not a focus event:

```ts
import { WEBVIEW_GUEST_FOCUS_EVENT } from "@domicile/chrome-sdk/webview-element";

// The window this shell drew, not the view: the event bubbles.
frame.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, () => {
  raise(frame);
});
```

One listener on the window covers the page and the chrome around it alike.
Read it as "the user is working in this window now": it is the only half of
that click you get, and a shell without it is a desktop where clicking a site
does not raise the window showing it.

### The keyboard, which is the part that bites

There is one seat and something is always in it, and a browser window names no
client — its page is inside your own. Three things follow, none optional:

- **Say the page has the keyboard** with `domicile.focusChrome()` when a
  browser window becomes the window being worked in. Without it the terminal
  that was focused keeps the seat while the user types into a site, and every
  key they press is delivered to a window they have switched away from.
- **Give it back when they move on**, by blurring whatever in the window holds
  the focus. The SDK forwards *this document's* keystrokes to whichever client
  the shell named, and a key pressed while a guest holds the focus never
  arrives in this document at all — so `focusApp` alone moves nothing, and a
  browser window left holding the focus makes every other window deaf. Open
  one, and every terminal after it stops taking keystrokes.
- **Claim your desktop chords** with `domicile.grabShortcut`. The browser
  process is the only layer above a focused guest: a key pressed on a site
  reaches neither this page nor the compositor. A claimed chord comes back as a
  `shortcut` message rather than as a DOM event, carrying the fields it was
  claimed with, because the page is not what received it.

Whether the window holds the keyboard at all is one question over both halves,
and the fork makes it one test: a `<webview>` whose guest has the focus is your
document's `activeElement`, the same as an address bar being typed into. So
`frame.contains(document.activeElement)` answers for the page and the chrome
together.

**And the page is not where focus goes when the window already has it.** A
press in the address bar is what made this the window being worked in, so a
shell that focuses the page on becoming focused spends the user's own press:
the caret lands in the bar and is pulled into the page a moment later, which is
an address bar that cannot be typed into at all.

### What a guest refuses

A page in one cannot open a second window, and permissions and dialogs are
answered by the default, which is no. Each is a piece of work rather than a
limit of the design; [ROADMAP.md](/ROADMAP.md) keeps the list.

## Bundling

One build, from your module rather than from a document, emitting one file
with a name Domicile can find:

```ts
// vite.config.ts
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "src/index.ts",
      output: { entryFileNames: "shell.js" },
    },
  },
});
```

`outDir` is yours — Domicile is handed a module, not a directory it expects a
name in, and the example uses a different one. Three things there are *not*
vite's defaults, and each fails quietly:

- **The entry is a `.ts` file**, so nothing emits a document for Domicile to
  have to ignore.
- **`entryFileNames` is fixed.** Vite hashes entry names by default, and the
  module you hand `domicile` is a path — a hash in it changes every time your
  shell does, so nothing could name the file: not you, not a package manager,
  not a script.
- **`base: "./"`** keeps the emitted URLs relative to the document Domicile
  writes rather than to a server root.

**Your CSS has to travel inside the bundle.** Vite pulls `import "./x.css"`
out into a separate asset and expects a document to `<link>` it; Domicile's
document has no link, so an extracted stylesheet is a file nobody fetches and
your desktop comes up unstyled. Fold it back in with a plugin at
`generateBundle` — this repo's own is
[`@domicile/component-library/vite-shell`](/packages/component-library/src/vite-shell.ts),
which is about thirty lines and worth reading rather than depending on.

That constraint pays for itself. A `<link>` is render-blocking and a
`type="module"` script is always deferred, so with one the browser paints
*before* any of your code has run — which is exactly where a theme flash comes
from. With no link there is nothing to paint yet, and your first line is early
enough.

There is no `node_modules` beside a shell and nothing resolves at run time, so
everything the page needs has to be *in* the bundle. That is vite's default for
a browser build and it is worth knowing you are relying on it.

## Distributing and running one

A shell is a directory with a module in it:

```
my-desktop/
  dist/
    shell.js
```

Nothing installs it, nothing registers it, and there is no shells directory.
Ship that directory however you like — a tarball, a git checkout, a nix
derivation — and point Domicile at it:

```sh
nix run github:cprussin/domicile -- ./my-desktop/dist/shell.js
```

The module, not the directory holding it. Domicile serves that directory —
whatever you put beside your entry is reachable and nothing above it is — but
which file it loads is the one you named, and a directory is refused rather
than searched. Nothing outside your build knows what your entry is called, so
nothing outside your build gets to guess.

That is the whole interface. A user of your shell never runs
`domicile-compositor`, never writes a Domicile config file, and does not need
to know either exists.
