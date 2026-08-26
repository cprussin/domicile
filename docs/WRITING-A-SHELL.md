# Writing a shell

A **shell** is a Domicile desktop: the panels, the window decorations, the
launcher, the wallpaper — and the compositor underneath them, which the shell
starts. Domicile ships two (`manganese` and `simple`), but neither is special. A
shell is an ordinary program in its own repository, installed on a user's
`PATH`, and this describes how to write one.

This is a guide, not a guideline: nothing here governs contributions to this
repo. For that see [`/AGENTS.md`](/AGENTS.md).

Everything below is worked end to end in
[`examples/minimal-shell`](/examples/minimal-shell), which lives outside the
bun workspace and is built against the *published* SDK by
[`scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh) on
every run of `./scripts/check.sh shell`. If this document and that example
disagree, the example is right — it is the one that is checked.

## What a shell is

A program a user runs. It starts `domicile-compositor`, connects to it as the
chrome, and mounts a `<domicile-app>` element per window.

Domicile is a compositor whose renderer is a web engine. A Wayland client that
maps a window becomes a `<domicile-app>` element in your page; where you put
that element is where the window is, and how you style it is how the window
looks. Deciding that — and nothing else — is a shell's whole job. The
compositor keeps the clients, the input, the outputs and the pixels.

**The shell is on top.** Domicile does not find shells, start them, or read
their configuration; it does not look in a shells directory and there is no
manifest. Someone running your desktop types your shell's name, configures your
shell's config file, and never learns that a `domicile-compositor` process
exists. That is the arrangement this document is about, and it is why a shell
is three programs rather than one:

| Program | What it is | What it does |
|---|---|---|
| the **launcher** | plain Node, the thing on `PATH` | starts the compositor, then starts the chrome inside it |
| the **chrome's main process** | Electron | opens the window and loads the page |
| the **page** | a renderer | mounts an element per app |

The launcher is separate from Electron for one reason: the chrome's window goes
on a display the compositor names, and Electron settles which display it draws
on while it starts up. Starting the compositor *first*, as a plain Node process,
is what makes the answer knowable in time.

## The launcher

```ts
// src/launch.ts
import { launchShell } from "@domicile/electron-chrome-host/launch-shell";

process.exitCode = await launchShell({
  config: myDesktop,                         // what to tell the compositor
  main: path.join(dirname, "main.js"),       // the Electron bundle
  present: true,                             // a desktop on a screen
}).catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`);
  return 1;
});
```

The `.catch` is not optional. A rejected top-level `await` is an unhandled
rejection, and what a runtime does with one is its own business — Electron pins
Node's legacy `--unhandled-rejections=warn`, where the reason goes to a stderr
nobody reads and the process exits 0. A desktop that did not start has to say
so and exit non-zero, and the line below is exactly when that happens.

`launchShell` starts `domicile-compositor`, waits for it to publish a session,
starts Electron with that session in its environment, and resolves with the
chrome's exit status — which is the shell's own, because the shell is what the
user ran. If the compositor never comes up it throws, carrying whatever the
compositor said on stderr, because that is where the reason is.

It reads four environment variables, all of them the *machine's* business
rather than any shell's:

| Variable | Meaning |
|---|---|
| `DOMICILE_COMPOSITOR` | Which compositor to run. Defaults to `domicile-compositor` on `PATH`. |
| `DOMICILE_ELECTRON` | Which Electron to run. It is not always on `PATH`; under `nix develop` it lives in the store. |
| `DOMICILE_ELECTRON_ARGS` | Extra arguments for it. What a *machine* needs, never what a shell wants — see below. |
| `XDG_RUNTIME_DIR` | Where the run's private directory goes — the chrome socket, the config, the session. Falls back to the temp directory. Keep it short: a Unix socket path is capped near 108 bytes, and a deep one will not bind. |

A shell cannot name its own interpreter or its own flags: one that could name
`/bin/sh` or turn its own sandbox off would be a different kind of program.

### The stub on `PATH`

`launchShell` runs under Node, and Electron ships one — so the shell needs no
separate Node install:

```sh
#!/bin/sh
set -eu
# Nothing downstream reads arguments, so nothing may be given: an argument that
# goes nowhere is a request that silently did not happen, and `minimal
# --headless` starting an ordinary desktop is exactly what the compositor's own
# command line goes out of its way to refuse.
if [ "$#" -gt 0 ]; then
  echo "minimal: takes no arguments, got: $*" >&2
  exit 2
fi
here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ELECTRON_RUN_AS_NODE=1
export ELECTRON_RUN_AS_NODE
exec "${DOMICILE_ELECTRON:-electron}" "$here/.vite/build/launch.js"
```

Name it after your shell and mark it executable. Whether your project's
`package.json` also points a `bin` field at it depends on how your shell gets
installed — see
[Distributing and running one](#distributing-and-running-one), which is also
where the manifest an installed shell ships is described.
`ELECTRON_RUN_AS_NODE` is what keeps this a Node process: without it Electron
would connect to a display before the compositor exists.

## The configuration

**The shell owns it.** Domicile has no user-facing configuration and no
well-known config path. What the compositor reads is a JSON file the shell
generates and hands over on a command line — a shell-to-compositor interface,
not a user interface. Nobody using your desktop should ever open it.

So the file a *person* edits is yours: your location, your schema, your names.
The one section you do not have to design is the desktop's shape, which is
Domicile's:

```ts
import { parseDesktop } from "@domicile/electron-chrome-host/desktop-config";

const config = parseDesktop(mine.desktop);
```

`parseDesktop` refuses anything the compositor would refuse — including a key
it does not read, which is almost always a misspelling of one it does. Refusing
it here means the message names the file the user actually wrote.

What it accepts:

| Key | Meaning |
|---|---|
| `displays` | The displays that make up the desktop: `{ name, size, position?, scale? }`. Empty means one output that follows the compositor's own window. |
| `nestedSize` | The desktop's size when no displays are described. |
| `maxScale` | The highest `wl_output` scale to advertise. A cost dial: a client asked to draw at scale N produces N² the pixels. |
| `keyboard` | `{ rules?, model?, layout?, variant?, options? }`, handed to libxkbcommon as its `xkb_*` settings. Whatever you leave out is *empty*, not inherited — including the whole section. An omitted `layout` is the one exception and means the compositor's ordinary one. |

The shipped shells read a file of their own at
`$XDG_CONFIG_HOME/domicile/<name>.json`:

```json
{
  "present": true,
  "desktop": {
    "displays": [
      { "name": "left", "size": [1920, 1080] },
      { "name": "right", "position": [1920, 0], "size": [2560, 1440], "scale": 2 }
    ]
  }
}
```

That shape is theirs, not a contract — `present` is a key the *shell* defines
and passes to `launchShell`. Yours can look like anything.

The compositor watches the file it is given and takes up a new desktop from it
while it runs — but **no shell can reach that yet**. The SDK writes the config
into a private directory it also removes, and tells nobody where: neither
`launchShell` nor `startCompositor` returns the path, and nothing takes one.
So a desktop that follows its own config is a thing the compositor can do and
the SDK cannot ask for. It wants a path on `RunningCompositor`, or one taken
in the options; neither exists.

## The session

Once the compositor is up it publishes a session document, and the launcher
passes it to the chrome's process in `DOMICILE_SESSION`. That is the whole of
what the two halves of a shell need to know about each other:

```ts
// src/main.ts, the Electron main process
import { sessionFromEnvironment } from "@domicile/electron-chrome-host/session-from-environment";

const session = sessionFromEnvironment(process.env);
```

| Field | Meaning |
|---|---|
| `protocol` | The host protocol version this compositor speaks. |
| `chromeSocket` | The Unix socket the host protocol is served on. |
| `waylandDisplay` | The display applications connect to. |
| `chromeWaylandDisplay` | The display the chrome's *own window* goes on — a different socket, because which one a client arrived on is how the compositor tells the desktop from the things running on it. |
| `composited` | Whether the compositor draws client windows itself. |

`composited` is the one that changes how you draw. When it is set, your window
must be **transparent** wherever an app shows through: the `<domicile-app>`
element is a hole, and a page that paints a background over it hides the very
window it is meant to show. When it is not, frames arrive as pixels and the
element draws them into a canvas itself.

`launchShell` sets `WAYLAND_DISPLAY` and passes `--ozone-platform=wayland`
for you when the compositor is compositing; you do nothing with either.

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
geometry it has to lay out against.

Version compatibility is that handshake and nothing else. A shell built against
an older SDK connects, is told the two numbers, and says so.

## The SDK

Two packages, both published to npm, both usable outside this repo:

| Package | What |
|---|---|
| `@domicile/chrome-sdk` | The in-page half. `BridgeClient` (the protocol), `registerElements` (the `<domicile-app>` and `<domicile-webview>` custom elements), and the pure helpers around them. |
| `@domicile/electron-chrome-host` | The process half: starting the compositor, the window, the socket, and dying with a reason. |

Neither is required. They are what this repo's own shells use, and a shell that
wants to speak the protocol itself may — it is newline-delimited JSON on a Unix
socket, described in `@domicile/chrome-sdk/protocol` and, on the other side, in
the `domicile-protocol` crate. Using the SDK means not reimplementing the frame
format, the input mapping, the placement reporting, and the launch dance.

`@domicile/component-library` is **not** part of the contract. It is the React
and Panda CSS design system this repo's own shells are built from, and it exists
to serve them. A shell outside this repo needs none of it — the example uses no
React at all.

## The smallest shell that works

Four files. The full version, with the comments, is in
[`examples/minimal-shell`](/examples/minimal-shell).

**`src/renderer.ts`** — the page, and the whole of the shell's behaviour:

```ts
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { postedTransport } from "@domicile/chrome-sdk/host-transport";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const host = window.domicileHost;
const transport =
  host === undefined
    ? { onMessage: () => undefined, send: () => undefined }
    : postedTransport(window, host);

const bridge = new BridgeClient(transport);
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
```

That is a working desktop: every window full-screen, newest on top. A real
shell differs from it only in where it puts the elements.

Three things this abbreviates, all of which the example does in full and none of
which are optional. `window.domicileHost` is `HostChannel | undefined` — the
page must open in an ordinary browser, where nothing injected it — so it is
branched on rather than asserted. `app_closed` is handled, because without it
every window leaks an element. And `bridge.connect()` resolves a `Result` that
must be reported rather than discarded; the example's `app_closed` also *throws*
on an app it never mounted, because a close for something never announced means
the page and the compositor disagree about what is on screen.

**`src/preload.ts`** — connects the socket and hands the page its messages.
The socket is held by the *preload* rather than the main process, deliberately:
a frame crossing Electron's IPC is a structured clone of the whole pixel buffer,
measured at 9.9ms for a 1612×982 window against 0.11ms for the same frame posted
with the buffer in the transfer list.

**`src/main.ts`** — reads the session, opens the window, and dies with a reason.
This is everything a page cannot do for itself.

**`src/launch.ts`** — [the launcher](#the-launcher).

## Bundling

Four builds, because Electron gives you three separate programs and the
launcher is a fourth:

| Build | Output | Notes |
|---|---|---|
| launcher | `.vite/build/launch.js`, ESM | A **Node** bundle: `node:*` external, `ssr.noExternal` for everything else. This is what the `bin` stub runs. |
| main | `.vite/build/main.js`, ESM | `electron` and `node:*` stay external. |
| preload | `.vite/build/preload.cjs`, **CJS** | Electron loads a preload as a sandboxed script, not a module. |
| renderer | `.vite/renderer/main_window/`, with `base: "./"` | The page is opened over `file://`, where absolute asset URLs resolve against the filesystem root and load nothing. |

Only the main and preload builds mark `electron` external — the renderer must
not import it at all. Everything the *page* needs is bundled, the SDK included:
there is no `node_modules` beside an installed shell.

**`ssr.noExternal` is what makes that true of the launcher**, and it is the one
thing in this table you cannot infer from the prose. `build.ssr: true` leaves
real dependencies as bare imports — that is what SSR externalisation is for —
so a launcher built without `noExternal` ships `import … from "@domicile/…"`
and dies on the first import once installed, with no `node_modules` to resolve
from. Inside
a workspace the SDK is symlinked source and gets bundled anyway, which is
exactly why this survives a checkout and fails an install. Every shell in this
repository had the bug until its packages were built for real.

## Distributing and running one

A shell is a directory with a `bin/` entry:

```
minimal/
  bin/minimal           ← on the user's PATH
  .vite/
    build/launch.js
    build/main.js
    build/preload.cjs
    build/package.json  ← for its "type", see below
    renderer/main_window/…
```

`package.json` is in that list for one field. `type` is what decides whether
Node parses a `.js` file as ESM or CJS — the launcher and main bundles are ESM
and use `import.meta.url`, and what settles that is the nearest `package.json`
walking up from them, so shipping the bundles without one leaves it to Node's
module detection rather than to you. (Emitting `.mjs` instead would settle it
the other way, and then you need no `package.json` at all.)

Beside the bundles rather than at the shell's root, which is where this file
used to say to put it. Two reasons, and the first is the rule above: `type`
has to reach `build/main.js` as well as `build/launch.js`, and only a manifest
in `build/` is the nearest one for both. The second is that a regular file at
the root of an installed tree is the one shape `nix profile` cannot merge, so
two shells that each ship a root `package.json` cannot be installed into one
profile — `nix profile add .#a .#b` fails on the conflict. (`nix build` is
fine; it writes `result` and `result-1`.) The flake in this repo ships both
`manganese` and `simple`, and found that out the hard way.

**Write it after the four builds, not beside your source.** The launcher build
is `emptyOutDir: true` — it is the one that clears `.vite/build/` — so a
manifest committed there is deleted the next time you build. The worked example
emits it as a `build:manifest` step the `build` script runs last; this repo's
flake installs it into `$out` after the build for the same reason.

A `bin` field is what a *package manager* uses to put the stub on `PATH`, and
it wants your project's root `package.json` — which is a different file from
the one above, and a fine place for it. The example ships one. What an
installed shell's *tree* should not carry is a root manifest, which is why the
nix packages here emit only the `type` one: nix links `$out/bin` itself, so a
`bin` field would earn nothing and the root file would cost a profile.

`DOMICILE_ELECTRON_ARGS` is the machine's, and it is worth saying what it is
not. A nix store build's sandbox helper is not setuid and cannot be, so such a
build is often said to need `--no-sandbox`. It does not: Chromium falls back to
the namespace sandbox, and a store-built shell comes up sandboxed on any host
with unprivileged user namespaces, which is the ordinary case. What needs the
flag is a host with those disabled, or a container running as root. Both are
the machine's business, which is why this is an environment variable and why no
shell should put `--no-sandbox` in its own stub: a shell that could name its
own flags could turn its own sandbox off.

Install it however you install a program. There is no shells directory, nothing
of Domicile's to register with, and no manifest: whatever puts `bin/minimal` on
`PATH` has installed the shell. `domicile-compositor` has to be on `PATH` too,
or named in `DOMICILE_COMPOSITOR`.

Then run it:

```sh
minimal
```

That is the whole interface. A user of your shell never runs
`domicile-compositor`, never writes a Domicile config file, and does not need to
know either exists.
