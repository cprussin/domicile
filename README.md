# Domicile

A Wayland compositor whose renderer is a web engine: a browser and a
compositor stitched into one unholy abomination, grafted together at the
layer tree, and — to the horror of everyone involved — it works. The desktop
is a web page, panels and decorations and launchers are web content, and each
Wayland window is an `<app>` element in that page that takes the same CSS as a
`<div>`.

[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) ·
[ROADMAP.md](ROADMAP.md) ·
[running a desktop](docs/RUNNING-A-DESKTOP.md)

## Write a shell

A shell is one built JavaScript module. Domicile writes the document, serves
it and runs the compositor underneath; where you put an `<app>` is where that
window goes, and deciding that is the whole job.

```tsx
const Shell = () => (
  <main>
    <app app-id={appId} />
    <webview src="https://example.com" />
  </main>
);
```

A native Wayland client and a web page, side by side in one flex container, as
nature never intended. Both are elements: lay them out and style them as you
would anything else — `z-index`, `transform`, `border-radius`, `opacity` and
`filter` all apply to the window, because to the page's compositor it is just
another layer and nobody told it otherwise.

```sh
nix run github:cprussin/domicile -- ./dist/shell.js
```

**[docs/WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)** is the guide: the
handshake, the config a shell owns, `<webview>`'s navigation and the keyboard
it has to hand back, and the bundling rules that fail quietly.
[examples/minimal-shell](examples/minimal-shell) is a whole one, built against
the published SDK from outside this repo.

## Manganese

The desktop Domicile ships, to prove the monster walks: tiling, keyed like
[sway](https://swaywm.org), under a transparent bar carrying the workspaces
and a clock, with browser windows that have an address bar.

```sh
nix run github:cprussin/domicile#manganese
```

Needs Nix and either a Wayland session or a console login — nothing to clone,
and no Chromium to build (that particular penance is already paid). Its keys
and its configuration are its own:
[shell-manganese](packages/shell-manganese/README.md).
[shell-simple](packages/shell-simple/README.md) is the other desktop in the
flake — floating windows and nothing around them.
