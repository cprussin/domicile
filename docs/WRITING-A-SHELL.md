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
nix run github:cprussin/domicile -- ./my-desktop/dist
```

That is the entire interface between a shell and Domicile: a directory with a
built module in it, called `shell.js`. **Domicile writes the document** — you
do not ship one, and there is no way to supply your own.

**A shell used to be a program, and this is the change worth knowing about if
you read an older version of this page.** It was three: a launcher on the
user's `PATH` that started the compositor, an Electron main process that opened
a window, and a preload holding the compositor's socket and posting frames
across the world boundary into the page. Domicile now ships its own Chromium
fork, in which the browser *is* the display compositor — a client's buffer goes
into the engine's layer tree rather than being copied into a canvas — so the
window, the socket and the process are Domicile's, and what is left for a shell
to be is the page. See
[ENGINE-FORK.md](/docs/architecture/ENGINE-FORK.md).

So there is no launcher to write, no `bin/` stub, no session to read out of the
environment, and nothing to install. There are three processes at run time and
none of them is yours:

| Process | What it does |
|---|---|
| the **bridge** | serves your page, and the compositor's socket, on one port |
| the **engine** | the fork, loading that page. It is the display compositor |
| the **compositor** | a producer to the engine: it keeps the Wayland clients and hands their buffers over |

The order is forced and Domicile forces it. A page cannot open a Unix socket
and `file:` has no origin to derive one from, which is why the bridge exists
and why your page is served over HTTP rather than opened off disk.

## The connection

One call, and it is the whole of the wiring:

```ts
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";

const bridge = new BridgeClient(
  connectToHost(window, (url) => new WebSocket(url)),
);
```

`connectToHost` opens a WebSocket to the bridge on the page's own origin. There
is nothing to configure and nothing to pass: the bridge serves the page and the
session from one port exactly so that no query string carries a socket path and
no two things can disagree about where the compositor is.

A page with no host gets a transport that does nothing, so the layout still
lays out and `<domicile-app>` says once that it cannot show a window. Ask
`hasHost(window)` if you need the question answered; do not reconstruct it.

Do not develop against that, though: it is the chrome with every window in it
missing, and a desktop's interesting behaviour is all on the other side of the
transport. `bun run --filter @domicile/shell-<name> start:dev` runs your shell
in a real desktop and rebuilds it as you save — which is what `vite dev` used
to be here, and what it could not be.

## The handshake

Connect, send `hello` with your protocol version, and wait for `welcome`. The
host ignores anything sent before the handshake completes, and a version it
refuses gets a `welcome` too — carrying *both* numbers, so you can say which two
disagreed rather than "something is wrong".

`BridgeClient.connect()` does this and resolves a `Result`. It does not throw:
a version mismatch is a value you are expected to report, because the two halves
having been built at different commits is a fact about the installation rather
than a bug in either.

The desktop — the displays and their layout — arrives *with* the handshake, so
a page that connects in the same millisecond as the socket still learns the
geometry it has to lay out against. A page that *reloads* is told again, along
with every window already open, so a reload comes back to the desktop that was
there rather than to an empty one.

Version compatibility is that handshake and nothing else. A shell built against
an older SDK connects, is told the two numbers, and says so.

## Reporting a failure

Say it on the console. Under Electron a page could neither write to a terminal
nor end the process, so both went over an IPC channel a preload injected; the
engine has no world boundary, and what a page logs reaches the terminal
Domicile was started from.

There is no way for a page to stop the desktop, and it does not need one: a
refused handshake leaves a page that draws nothing, which is visible, and the
line on the console is what says why.

## The configuration

**The shell owns whatever a user edits.** Domicile has no user-facing
configuration and no well-known config path: your location, your schema, your
names.

The compositor takes a `--config` naming a JSON file that describes the
desktop — the displays, their layout, the keyboard — and watches it for
changes while it runs. **Nothing passes one under the engine.**
`scripts/run-engine.sh` starts the compositor without a config, so it runs a
single output that follows its own window, and a shell has no way to describe a
two-screen desktop. The compositor's side is built and the shell's side is not
wired; that is a gap rather than a decision.

`@domicile/chrome-sdk` does not parse that file. `parseDesktop` lived in the
Electron host package, which is gone; the schema it enforced is the
`domicile-config` crate's, and there is no published TypeScript parser for it
today.

## The SDK

One package, published to npm and usable outside this repo:

| Package | What |
|---|---|
| `@domicile/chrome-sdk` | `BridgeClient` (the protocol), `connectToHost` (the wire), `registerElements` (the `<domicile-app>` and `<domicile-webview>` custom elements), and the pure helpers around them. |

It is not required. A shell that wants to speak the protocol itself may — it is
newline-delimited JSON over a WebSocket, described in
`@domicile/chrome-sdk/protocol` and, on the other side, in the
`domicile-protocol` crate. Using the SDK means not reimplementing the frame
format, the input mapping and the placement reporting.

`@domicile/engine-chrome-host` is Domicile's own bridge — the program that
serves your page and the socket. You do not depend on it; it runs you.

`@domicile/component-library` is **not** part of the contract. It is the React
and Panda CSS design system this repo's own shells are built from, and it exists
to serve them. A shell outside this repo needs none of it — the example uses no
React at all.

## The smallest shell that works

Two files. The full version, with the comments, is in
[`examples/minimal-shell`](/examples/minimal-shell).

**`src/renderer.ts`** — the page, and the whole of the shell's behaviour:

```ts
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const bridge = new BridgeClient(
  connectToHost(window, (url) => new WebSocket(url)),
);
registerElements(bridge);

const mounted = new Map<string, HTMLElement>();

bridge.on("app_appeared", ({ app_id }) => {
  const element = document.createElement("domicile-app");
  element.setAttribute("app-id", app_id);
  document.body.append(element);
  mounted.set(app_id, element);
});

bridge.on("app_closed", ({ app_id }) => {
  mounted.get(app_id)?.remove();
  mounted.delete(app_id);
});

bridge.connect().then(/* report the Result */);
```

That is a working desktop: every window full-screen, newest on top. A real
shell differs from it only in where it puts the elements.

Three things this abbreviates, all of which the example does in full and none of
which are optional. `app_closed` is handled, because without it every window
leaks an element. `bridge.connect()` resolves a `Result` that must be reported
rather than discarded. And the example's `app_closed` *throws* on an app it
never mounted, because a close for something never announced means the page and
the compositor disagree about what is on screen.

There is no second file. **Domicile writes the document**: a charset, a
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
- **`entryFileNames` is fixed.** Vite hashes entry names by default, and
  `DOMICILE_MODULE` is a path — a hash in it changes every time your shell
  does, so nothing could name the file: not you, not a package manager, not a
  script.
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
nix run github:cprussin/domicile -- ./my-desktop/dist
nix run github:cprussin/domicile -- ./my-desktop/dist/shell.js
```

Either works. Domicile serves the directory the module is in, so naming the
module and naming what contains it are the same instruction.

That is the whole interface. A user of your shell never runs
`domicile-compositor`, never writes a Domicile config file, and does not need
to know either exists.
