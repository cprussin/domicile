# Domicile

A Wayland compositor whose renderer is a web engine.

- All user chrome — panels, decorations, launchers — is web content.
- An app window is a real Wayland client, composited *inside* the engine as a
  DOM element. `<app>` takes the same CSS as a `<div>`.
- A client rendering on the GPU has its buffer composited directly, no copy.
- A client drawing in software gets a blank window: its pixels are in shared
  memory, and the engine can only take a GPU buffer. The upload that would
  convert one is not built yet
  ([why](docs/architecture/WINDOW-COMPOSITING.md)).

[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md)

## Run a desktop

Needs Nix and a Wayland session. Nothing to clone.

```sh
nix run github:cprussin/domicile#manganese   # tabs, stage, address bar
nix run github:cprussin/domicile#simple      # floating windows only
```

- Each desktop is its own app. `nix profile install` the one you want.
- You get a window. A tty is refused for now
  ([why](docs/architecture/ENGINE-FORK.md)).
- The forked engine is a prebuilt package the flake pins — no Chromium build
  ([how](packages/domicile-engine/README.md#getting-one-without-building-it)).
- Keys and configuration are each desktop's own:
  [simple](packages/shell-simple/README.md),
  [manganese](packages/shell-manganese/README.md). Domicile has none.
- Launching a client into the desktop works the same under either:
  [how](packages/shell-simple/README.md#launch-an-app-into-it).

## Write your own

A shell is one built JavaScript module. Where you put a `<domicile-app>` is
where that window goes, and deciding that is the whole job.

```js
// shell.js
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const domicile = new DomicileClient(connectToHost(navigator));
registerElements(domicile);

domicile.on("app_appeared", ({ app_id }) => {
  const app = document.createElement("domicile-app");
  app.setAttribute("app-id", app_id);
  document.body.append(app);
});
```

```sh
npx esbuild shell.js --bundle --format=esm --outfile=dist/shell.js

nix profile install github:cprussin/domicile#domicile
domicile ./dist/shell.js

# or, installing nothing:
nix run github:cprussin/domicile -- ./dist/shell.js
```

That is a desktop: every window full-screen, newest on top.

- No document to write — Domicile writes it. No launcher, no `bin/` entry,
  nothing of yours to install.
- Ship the directory however you like.
- Two things the example above skips, neither optional: remove the element on
  `app_closed`, and report the `Result` that `connect()` resolves.

**[docs/WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)** is the guide — the
handshake, the bundling rules that fail quietly, and what the document Domicile
writes contains. [examples/minimal-shell](examples/minimal-shell) is the above
in full, built against the published SDK from outside this workspace.

## Work on Domicile

```sh
nix develop                        # core crates + TypeScript workspace
nix develop .#full                 # adds Wayland/DRM/GL — needed below

./scripts/check.sh                 # or one group: shell, rust, typescript, e2e
./scripts/dev-shell.sh manganese   # a shell in a real desktop, rebuilt on save
```

[AGENTS.md](AGENTS.md) is the contributor's index.
