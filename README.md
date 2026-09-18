# Domicile

A Wayland compositor whose renderer is a web engine.

- All user chrome — panels, decorations, launchers — is web content.
- An app window is a real Wayland client, composited *inside* the engine as a
  DOM element. `<app>` takes the same CSS as a `<div>`.
- A web page is a window on the same terms: `<webview src="…">` is a
  browsing context of its own, driven by `goBack` / `goForward` / `stop` /
  `reload` on the element. A browser is an address bar you style yourself, and
  a site that refuses framing loads in one.
- A client rendering on the GPU has its buffer composited directly, no copy.
- A client drawing in software gets a blank window: its pixels are in shared
  memory, and the engine can only take a GPU buffer. The upload that would
  convert one is not built yet
  ([why](docs/architecture/WINDOW-COMPOSITING.md)).

[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md)

## Run a desktop

Needs Nix, and either a Wayland session or a console login. Nothing to
clone.

```sh
nix run github:cprussin/domicile#manganese   # tiling, sway's keys, address bar
nix run github:cprussin/domicile#simple      # floating windows only
```

- Each desktop is its own app. `nix profile install` the one you want.
- Inside a Wayland session you get a window; on a bare tty you get the screen.
  Nothing to set either way — a console login has `XDG_VTNR` and takes the DRM
  platform on its own ([how](docs/architecture/A-DESKTOP-ON-A-TTY.md)).
- The forked engine is a prebuilt package the flake pins — no Chromium build
  ([how](packages/domicile-engine/README.md#getting-one-without-building-it)).
- Keys and configuration are each desktop's own:
  [simple](packages/shell-simple/README.md),
  [manganese](packages/shell-manganese/README.md). Domicile has none.
- Launching a client into the desktop works the same under either:
  [how](packages/shell-simple/README.md#launch-an-app-into-it).

On NixOS, `homeManagerModules.default` describes a desk where the rest of your
environment is — an option per field of the compositor's config, and the shell
baked into `domicile` so it is not typed twice:

```nix
{
  imports = [domicile.homeManagerModules.default];

  programs.domicile = {
    enable = true;
    shell = "${domicile.packages.${system}.manganese}/shell.js";
    settings.output.profiles = [{
      name = "desk";
      displays = [{display = "DEL DELL U3219Q 2ZLS413"; scale = 1.2; transform = "rotate-270";}];
    }];
  };
}
```

It writes the config and installs no session — booting into a desk is a
machine's decision, not a home directory's.

## Write your own

A shell is one built JavaScript module. Where you put an `<app>` is
where that window goes, and deciding that is the whole job.

```js
// shell.js
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const domicile = new DomicileClient(connectToHost(window));
registerElements(domicile);

domicile.on("app_appeared", ({ app_id }) => {
  const app = document.createElement("app");
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
  `app_closed`, and call `reportDevicePixelRatio` so clients draw at the
  display's real resolution.

A browser window is the other tag, with no Wayland client behind it:

```js
const view = document.createElement("webview");
view.src = "https://example.com";
document.body.append(view);

back.addEventListener("click", () => {
  view.goBack();
});
```

`canGoBack` / `canGoForward` say whether a control would do anything and
`loading` says whether a page is still arriving, and the element announces a
click in the page and a change to any of them — nothing else crosses out of a
guest. That is the whole of a browser:
[manganese's](packages/shell-manganese/src/window-management/BrowserWindow.tsx)
is this plus the chrome it draws around it.

**[docs/WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)** is the guide — the
handshake, the keyboard a browser window has to hand back, the bundling rules
that fail quietly, and what the document Domicile writes contains.
[examples/minimal-shell](examples/minimal-shell) is the `<app>` shell above in
full, built against the published SDK from outside this workspace.

## Work on Domicile

```sh
nix develop                        # core crates + TypeScript workspace
nix develop .#full                 # adds Wayland/DRM/GL — needed below

./scripts/check.sh                 # or one group: shell, rust, typescript, e2e
./scripts/dev-shell.sh manganese   # that shell in a real desktop, rebuilt on save
```

A rebuild does not reload the running desktop — restart it — until
`domicile load-shell` lands
([why](docs/architecture/THE-DOMICILE-BINARY.md)).

[AGENTS.md](AGENTS.md) is the contributor's index.
