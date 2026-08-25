# Writing a shell

A **shell** is the user chrome of a Domicile desktop: the panels, the window
decorations, the launcher, the wallpaper — everything that is not an
application. Domicile ships two (`manganese` and `simple`), but neither is
special. A shell is an ordinary program in its own repository, installed into a
directory Domicile looks in, and this describes how to write one.

This is a guide, not a guideline: nothing here governs contributions to this
repo. For that see [`/AGENTS.md`](/AGENTS.md).

Everything below is worked end to end in
[`examples/minimal-shell`](/examples/minimal-shell), which lives outside the
bun workspace and is built against the *published* SDK by
[`scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh) on
every run of `./scripts/check.sh shell`. If this document and that example
disagree, the example is right — it is the one that is checked.

## What a shell is

A web page that mounts `<domicile-app>` elements, plus a process that holds a
Unix socket to the compositor.

Domicile is a compositor whose renderer is a web engine. A Wayland client that
maps a window becomes a `<domicile-app>` element in your page; where you put
that element is where the window is, and how you style it is how the window
looks. Deciding that — and nothing else — is a shell's whole job. The
compositor keeps the clients, the input, the outputs and the pixels.

Concretely, a shell:

1. is started **by Domicile**, not the other way round;
2. connects to the socket Domicile names in its environment;
3. agrees a protocol version;
4. mounts an element per app the compositor announces, and reports where it put
   it.

You do not implement the protocol. [`@domicile/chrome-sdk`](#the-sdk) does, and
what you write is the page above it.

## The contract

Three things: a manifest, the environment you are started with, and the
handshake.

### The manifest

A shell package is a directory with a `domicile.shell.json` at its root:

```json
{
  "description": "The smallest shell that works: every app full-screen, newest on top",
  "entry": ".vite/build/main.js",
  "name": "minimal",
  "protocol": 14
}
```

| Field | Meaning |
|---|---|
| `name` | What the shell calls itself, and what `package = "minimal"` in a Domicile config looks up. Must be a single path segment — no `/`, no `..`. When installed by name, it must match the directory it is installed as. |
| `description` | One line, for a compositor listing what is installed. |
| `protocol` | The host protocol version this build speaks. Domicile refuses to start a shell whose number is not its own. |
| `entry` | The program Domicile runs, relative to the package directory. `./main.js` and `build/main.js` are both fine; an absolute path, or one containing `..`, is refused. |

`entry` is what decides the entry point — **not** the `main` field of a
`package.json`. Domicile never reads your `package.json`.

`protocol` is the version your build of `@domicile/chrome-sdk` speaks; it is
exported as `PROTOCOL_VERSION` from `@domicile/chrome-sdk/protocol`. Bumping the
SDK across a protocol change means bumping this number in the same commit.
Getting it wrong is a refusal at startup that names the file, rather than a
desktop that comes up subtly broken.

Unknown fields are refused rather than ignored: a key that does nothing is
almost always a misspelling of one that does, and a manifest is small enough
that a typo in it is otherwise invisible.

### The environment

Domicile starts your `entry` with these set, on top of the session's own
variables:

| Variable | Meaning |
|---|---|
| `DOMICILE_CHROME_SOCKET` | The Unix socket the host protocol is served on. |
| `WAYLAND_DISPLAY` | The display your *own* window goes on — set **only** when `DOMICILE_COMPOSITED` is. This is not the display apps connect to: which socket a client arrives on is how Domicile tells the chrome from the applications. When Domicile is not compositing, your window is an ordinary one on whatever display the session already has, and Domicile leaves this alone. |
| `DOMICILE_SHELL_SETTINGS` | Your own `[shell.settings]` table from `domicile.toml`, as JSON. Always set, always an object. |
| `DOMICILE_COMPOSITED` | Set to `1` when Domicile draws the clients itself. Then your window must be **transparent** wherever an app shows through: the `<domicile-app>` element is a hole, and a page that paints a background over it hides the very window it is meant to show. When it is unset, frames arrive as pixels and the element draws them into a canvas itself. |

Your working directory is the package directory.

Which of these is your job is worth being precise about, because the SDK does
less here than it looks:

- `DOMICILE_CHROME_SOCKET` — `chromeSocketPath(process.env)` from
  `@domicile/electron-chrome-host` reads it for you. It is the only one that
  package touches.
- `DOMICILE_COMPOSITED` — **you** read it and hand the result to
  `openChromeWindow({ composited, … })`; see the example's `main.ts`.
- `DOMICILE_SHELL_SETTINGS` — yours entirely; nothing reads it but your shell.
- `WAYLAND_DISPLAY` — Electron's, via ozone, and only when compositing. You do nothing with it; Domicile also passes `--ozone-platform=wayland` in that case so Electron does not default to X11 and put your chrome on the host session's desktop instead of inside the compositor it is the chrome of.

### The handshake

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

## The SDK

Two packages, both published to npm, both usable outside this repo:

| Package | What |
|---|---|
| `@domicile/chrome-sdk` | The in-page half. `BridgeClient` (the protocol), `registerElements` (the `<domicile-app>` and `<domicile-webview>` custom elements), and the pure helpers around them. |
| `@domicile/electron-chrome-host` | The process half, for a shell hosted in Electron: the window, the socket, and dying with a reason. |

Neither is required. They are what this repo's own shells use, and a shell that
wants to speak the protocol itself may — it is newline-delimited JSON on a Unix
socket, described in `@domicile/chrome-sdk/protocol` and, on the other side, in
the `domicile-protocol` crate. Using the SDK means not reimplementing the frame
format, the input mapping, and the placement reporting.

`@domicile/component-library` is **not** part of the contract. It is the React
and Panda CSS design system this repo's own shells are built from, and it exists
to serve them. A shell outside this repo needs none of it — the example uses no
React at all.

## The smallest shell that works

Three files. The full version, with the comments, is in
[`examples/minimal-shell`](/examples/minimal-shell).

**`src/renderer.ts`** — the page, and the whole of the shell's behaviour. The
shape of it, lifted from the example:

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
must be reported rather than discarded, per [the handshake](#the-handshake);
the example's `app_closed` also *throws* on an app it never mounted, because a
close for something never announced means the page and the compositor disagree
about what is on screen.

**`src/preload.ts`** — connects the socket and hands the page its messages.
The socket is held by the *preload* rather than the main process, deliberately:
a frame crossing Electron's IPC is a structured clone of the whole pixel buffer,
measured at 9.9ms for a 1612×982 window against 0.11ms for the same frame posted
with the buffer in the transfer list.

**`src/main.ts`** — opens the window and dies with a reason. This is everything
a page cannot do for itself, and it is only those two things.

## Bundling

Electron gives you three separate programs, so there are three builds:

| Build | Output | Notes |
|---|---|---|
| main | `.vite/build/main.js`, ESM | `electron` and `node:*` stay external. This is what `entry` points at. |
| preload | `.vite/build/preload.cjs`, **CJS** | Electron loads a preload as a sandboxed script, not a module. |
| renderer | `.vite/renderer/main_window/`, with `base: "./"` | The page is opened over `file://`, where absolute asset URLs resolve against the filesystem root and load nothing. |

Only the main and preload builds mark `electron` external — the renderer must
not import it at all. Everything the *page* needs is bundled, the SDK included:
there is no `node_modules` beside an installed shell.

## Distributing and running one

A shell is a directory. Ship whatever your build produced, plus the manifest:

```
minimal/
  domicile.shell.json
  package.json          ← for its "type", see below
  .vite/
    build/main.js
    build/preload.cjs
    renderer/main_window/…
```

`package.json` is in that list for one field. The main bundle is ESM and uses
`import.meta.url`, and what decides whether Node parses a `.js` file as ESM or
CJS is the nearest `package.json`'s `"type"` walking up from it — so shipping
the bundle without one leaves that to Node's module detection rather than to
you. Domicile itself never reads this file; `entry` is what it runs. (Emitting
`main.mjs` instead would settle it the other way, and then you need no
`package.json` at all.)

Install it where Domicile looks, which is XDG:

- `$XDG_DATA_HOME/domicile/shells/` (default `~/.local/share/domicile/shells/`)
- then each entry of `$XDG_DATA_DIRS` (default `/usr/local/share:/usr/share`),
  as `<entry>/domicile/shells/`

Nearest first, so a shell a user installs for themselves shadows a system one of
the same name — which is how you try a modified build without replacing what is
installed for everyone. The directory must be named the same as the manifest's
`name`.

Then name it in `domicile.toml`:

```toml
[shell]
package = "minimal"
```

or point at a directory anywhere, which is what you want while developing:

```toml
[shell]
package = "/home/me/src/my-shell"
```

A path is taken as given and the search path is not consulted, so a checkout
needs no install step and may be called anything. Write it out in full: `~` is
**not** expanded — on a command line your shell expands it before Domicile sees
it, but nothing does that for a config file, and `package = "~/src/my-shell"`
fails naming a path with a `~` still in it. A relative path is resolved against
the compositor's working directory.

`[shell.settings]` is how a *user* configures **your** shell. Domicile does not
interpret it and has no schema for it — that is yours to define and document,
the way any program documents its own config.

Say your shell puts its window list down one side of the screen and you want
that switchable. You define `rail = "left" | "right"`, a user writes it in their
`domicile.toml`, and you read it. Domicile's only job is carrying the table from
one to the other, which it does in `DOMICILE_SHELL_SETTINGS` as JSON — the
reader is a web page, which has a parser for that and none for TOML. It is
always set and always an object, so an absent table and an empty one are the
same case rather than two:

```toml
[shell]
package = "minimal"

[shell.settings]
rail = "left"
clock = true
```

```ts
// in the Electron main process, which is where the environment is
const settings = JSON.parse(process.env.DOMICILE_SHELL_SETTINGS ?? "{}");
```

Parse it into a schema you own rather than trusting its shape — it is a config
file someone edited by hand.

TOML's types cross to their JSON counterparts, with one that has none: a date or
datetime arrives as its own text (`"1979-05-27T07:32:00Z"`), because JSON has no
date type.

Start it:

```sh
domicile-compositor --present
```

Domicile starts whatever the config names. `--shell <name-or-path>` — or
`--shell=<name-or-path>` — overrides it without editing the config, which is
what you want while developing.

**Naming no shell anywhere is an error, not a quiet headless boot.** If the
config has no `[shell] package` and the command line names nothing, Domicile
refuses to start and says so — the alternative is a window with nothing drawn in
it, which tells you nothing about the missing key that caused it. To serve the
chrome socket deliberately without starting anything — which is how this repo's
own end-to-end checks drive it, with a stand-in chrome of their own — pass
`--no-shell`.

Two environment variables belong to the machine rather than to any shell, and
Domicile *reads* them to build the command (they also reach your process, but
only because the whole environment is inherited):

- `DOMICILE_ELECTRON` — which Electron to run. It is not always on `PATH`; under
  `nix develop` it lives in the store.
- `DOMICILE_SHELL_ARGS` — extra arguments for it. A nix store build carries no
  setuid sandbox helper and needs `--no-sandbox`.

Neither is something a manifest may ask for: a shell that could name its own
interpreter could name `/bin/sh`, and one that could name its own flags could
turn its own sandbox off.

## Versioning

`protocol` in your manifest is the whole compatibility story, and it is checked
twice: once before your process starts, against the manifest, and once at the
handshake, against what your build actually sends. The first is what gives a
useful message — it can name your package and the file that declared the number.

When Domicile bumps `PROTOCOL_VERSION`, a shell built against the old SDK
refuses to start until it is rebuilt and its manifest bumped. That is
deliberate: the alternative is a desktop that comes up and then behaves
incorrectly in whichever way the protocol changed.

The SDK packages are versioned independently, by ordinary semver. Their npm
version does not encode the protocol number; `PROTOCOL_VERSION` does, exported
from `@domicile/chrome-sdk/protocol`. Nothing generates the manifest from it —
this repo's own shells, the example included, write the number by hand and are
kept honest by a test that fails when the two drift. Generating `protocol` in
your build step is a reasonable thing to do and nothing here stops you.
