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
compositor underneath; a Wayland client that maps a window becomes a
`<domicile-app>` element in your page, and where you put that element is where
the window is. Deciding that — and nothing else — is a shell's whole job. The
compositor keeps the clients, the input, the outputs and the pixels.

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
the channel to the compositor is `navigator.domicile` rather than a socket the
page opens, because a page cannot open a Unix socket and nothing here binds a
port.

## The connection

One call, and it is the whole of the wiring:

```ts
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";

const domicile = new DomicileClient(connectToHost(navigator));
```

`connectToHost` reads `navigator.domicile`, which is the control channel the
engine puts on a document it served. There is nothing to configure and nothing
to pass: it is a property of the page, so no query string carries a socket path
and no two things can disagree about where the compositor is.

A page with no compositor gets a stand-in that does nothing, so the layout
still lays out and `<domicile-app>` says once that it cannot show a window —
and `connectToHost` says once, on the console, that there was no compositor to
find. Ask `hasHost(navigator)` if you need the question answered in your own
code; do not reconstruct it.

Do not develop against that, though: it is the chrome with every window in it
missing, and a desktop's interesting behaviour is all on the other side of the
channel. Point `domicile` at your shell's module and let your own bundler watch
it — `vite build --watch` beside `domicile ./dist/shell.js` is the whole dev
loop, and
it is a real desktop rather than a page pretending to be one.

## There is no handshake

There used to be one — `hello` with a version number, `welcome` with the
host's, and everything a shell said before that on the floor. **A shell does
nothing about versions now.** The channel is a typed surface rather than a
message pipe: the compositor's protocol version is checked in the browser
process, which logs a disagreement and carries on, and a page has no part in it
and nothing to await. `DomicileClient` has no `connect()` — say what you have to
say as soon as you have a client, and the first call is what binds the channel.

What replaces the handshake as a *shell's* concern is registration order, and
`DomicileClient` is what handles it: it registers its own listeners in its
constructor and holds anything that arrives before your `on` does. A React
shell registers in its first effect flush, tens of milliseconds late, and every
window already running is announced before then.

**So never call `addEventListener` on `navigator.domicile` yourself.** It
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
configuration and no well-known config path: your location, your schema, your
names.

The compositor takes a `--config` naming a JSON file that describes the
desktop — the displays, their layout, the keyboard — and watches it for
changes while it runs. **Nothing passes one under the engine.**
`domicile` starts the compositor without a config, so it runs a single output
that follows its own window, and a shell has no way to describe a two-screen
desktop. The compositor's side is built and the shell's side is not
wired; that is a gap rather than a decision.

`@domicile/chrome-sdk` does not parse that file. Its schema is the
`domicile-config` crate's, and there is no published TypeScript parser for it
today.

## The SDK

One package, published to npm and usable outside this repo:

| Package | What |
|---|---|
| `@domicile/chrome-sdk` | `DomicileClient` (the control channel), `connectToHost` (finding it), `registerElements` (the `<domicile-app>` and `<domicile-webview>` custom elements), and the pure helpers around them. |

It is not required. A shell may drive `navigator.domicile` itself — it is a
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

**`src/renderer.ts`** — the page, and the whole of the shell's behaviour:

```ts
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const domicile = new DomicileClient(connectToHost(navigator));
registerElements(domicile);

const mounted = new Map<string, HTMLElement>();

domicile.on("app_appeared", ({ app_id }) => {
  const element = document.createElement("domicile-app");
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
leaks an element. One thing the snippet abbreviates, and the example does in
full: the example's `app_closed` *throws* on an app it never mounted, because a
close for something never announced means the page and the compositor disagree
about what is on screen.

There is no document to write. **Domicile writes it**: a charset, a
viewport, and a `<body>` that fills the window with no margin. That last one is
not a nicety — eight pixels of default body margin is eight pixels the
compositor believes it has and does not, and a client's window drawn eight
pixels out looks like the seam rather than like a stylesheet.

**Nothing else, and in particular no element to mount into.** The body and the
script tag that loads you are the whole of it, so a shell that renders into a
container makes its own — `document.body.append` on the first line, as the
example above does. Worth stating because the vaguer wording this sentence used
to have ("a root that fills the window") cost a desktop: `shell-manganese` read
it as an element with that id, looked one up, got `null`, and threw before it
rendered anything. Under `--app` there is no console to read, so the whole
failure was a white window.

What is left to you is the background: make it transparent wherever an app
shows through, because a `<domicile-app>` is a hole in your page and a
background painted over it hides the very window it is meant to show.

The title is Domicile's until you say otherwise with `document.title`. It does
not guess — the directory a module came out of is as likely to be `dist` as
anything a person would recognise.

## What a window has to be told

Two facts reach your shell as messages and have to reach the element, because
nothing else carries them: the size the client drew at (`app_resized`, and on
`app_appeared` for a client that has already drawn), which is what the pointer
is scaled by, and the cursor the client asked for (`app_cursor`).

Each is a method and a property, and they do the same thing:

```ts
element.setSurfaceSize(width, height); // or: element.surfaceSize = [width, height]
element.applyCursor(cursor); //           or: element.cursor = cursor
element.focusApp(); //                    or: element.focused = true
```

Reach for the methods when your shell holds the elements and calls them as the
messages arrive, as the example does. Reach for the properties when your shell
*renders* — React, or any template that writes props onto an element it owns —
because then these are props like any other, and nothing has to keep a registry
of live elements to call a method on. `undefined` means the client has asked
for nothing: no size is one that has not drawn, no cursor is the page's own.

`focused` goes one way only. Which client holds the keyboard is one seat's
answer, so "this window has it" is an instruction and "this window does not" is
not one; see below for where the keyboard goes instead.

## Who gets the keyboard

The compositor holds it — it is the only thing that can deliver a key — but
every move of it starts with your shell. Two questions reach you, and a shell
that answers neither is the desktop the smallest one above already is: a click
focuses the window under it, and a client that asks for focus is ignored.

**A click on a window** is the first. `<domicile-app>` fires a cancellable
`domicile-focus-requested` on itself (`APP_FOCUS_REQUESTED_EVENT` from
`@domicile/chrome-sdk/app-element`) and, left alone, focuses the client — which
is what you want when your shell has no opinion. Call `preventDefault()` on it
and nothing moves until you say so:

```ts
document.addEventListener(APP_FOCUS_REQUESTED_EVENT, (event) => {
  const { appId } = (event as CustomEvent<AppFocusRequest>).detail;
  event.preventDefault();
  if (myPolicySays(appId)) {
    mounted.get(appId)?.focusApp();
  }
});
```

It bubbles, so one listener covers every window.

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

## Bundling

One build, from your module rather than from a document, emitting one file
with a name Domicile can find:

```ts
// vite.renderer.config.ts
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "src/renderer.ts",
      output: { entryFileNames: "shell.js" },
    },
  },
});
```

Three things there are not vite's defaults, and each fails quietly:

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
