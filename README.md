# Domicile

A Wayland compositor whose renderer is a web engine. All user chrome is web
content; app windows are real Wayland clients composited *inside* the engine as
DOM elements, so `<app>` takes the same CSS as a `<div>`.

A GPU client's buffer is composited directly, with no copy. A `wl_shm` client
has no buffer the engine can take, so its window stays blank until the upload
exists ([why](docs/architecture/WINDOW-COMPOSITING.md)).
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) ·
[ROADMAP.md](ROADMAP.md)

## Run one of the two desktops

Needs Nix and a Wayland session. Nothing to clone.

```sh
nix run github:cprussin/domicile#manganese   # tabs, stage, address bar
nix run github:cprussin/domicile#simple      # floating windows only
```

Which desktop is **which app**, not an argument to one of them. To install
rather than run:

```sh
nix profile install github:cprussin/domicile#manganese
```

You get a window, the way starting sway inside sway does. A tty is refused for
now: the whole screen needs an ozone platform Chromium will not build outside
ChromeOS ([why](docs/architecture/ENGINE-FORK.md)). The forked engine comes
down as a prebuilt package the flake pins, so none of this is a Chromium build
— [how that works](packages/domicile-engine/README.md#getting-one-without-building-it).

Each desktop's keys are in its own README —
[simple](packages/shell-simple/README.md),
[manganese](packages/shell-manganese/README.md) — as is its configuration,
because a desktop owns whatever a user edits and Domicile has none of its own.
Pointing a Wayland client at the display is
[in simple's](packages/shell-simple/README.md#launch-an-app-into-it) and works
the same under either.

## Write your own desktop

Neither shipped desktop is privileged. A shell is a built JavaScript module in
its own repository — the panels, the decorations, the launcher — and Domicile
runs it. Where you put a `<domicile-app>` is where that window is, and deciding
that is a shell's whole job.

```js
// shell.js
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const bridge = new BridgeClient(
  connectToHost(window, (url) => new WebSocket(url)),
);
registerElements(bridge);

bridge.on("app_appeared", ({ app_id }) => {
  const app = document.createElement("domicile-app");
  app.setAttribute("app-id", app_id);
  document.body.append(app);
});

await bridge.connect();
```

Bundle it under the name Domicile looks for, and run it:

```sh
npx esbuild shell.js --bundle --format=esm --outfile=dist/shell.js

nix profile install github:cprussin/domicile#domicile   # `domicile` on PATH
domicile ./dist/shell.js
```

Or without installing anything:
`nix run github:cprussin/domicile -- ./dist/shell.js`.

That is a desktop: every window full-screen, newest on top. There is no
document to write — Domicile writes it — no launcher, no `bin/` entry, and
nothing of yours to install: ship the directory however you like. A real shell
differs from this only in where it puts the elements and what it draws around
them.

Two things it leaves out, and neither is optional: removing the element on
`app_closed`, and reporting the `Result` that `connect()` resolves rather than
discarding it.

**[docs/WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md) is the guide** — the
handshake, the bundling rules that fail quietly, and what the document Domicile
writes does and does not contain. [examples/minimal-shell](examples/minimal-shell)
is the above in full, built against the published SDK from outside this
workspace exactly as yours would be, and checked on every run of
`./scripts/check.sh shell`.

## Work on Domicile itself

```sh
nix develop                        # core crates + TypeScript workspace
nix develop .#full                 # adds Wayland/DRM/GL — needed for the two below

./scripts/check.sh                 # everything; or one group: shell, rust, typescript, e2e
./scripts/dev-shell.sh manganese   # a shell in a real desktop, rebuilt as you save
```

[AGENTS.md](AGENTS.md) is the contributor's index — the guidelines every change
is held to, and what `check.sh` cannot reach.
