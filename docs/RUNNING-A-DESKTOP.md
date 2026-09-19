# Running a desktop

Needs Nix, and either a Wayland session or a console login. Nothing to clone.

```sh
nix run github:cprussin/domicile#manganese   # tiling, sway's keys, address bar
nix run github:cprussin/domicile#simple      # floating windows only
```

This is a guide, not a guideline: nothing here governs contributions to this
repo. For that see [`/AGENTS.md`](/AGENTS.md).

- Each desktop is its own app. `nix profile install` the one you want.
- Inside a Wayland session you get a window; on a bare tty you get the screen.
  Nothing to set either way — a console login has `XDG_VTNR` and takes the DRM
  platform on its own
  ([how](/docs/architecture/A-DESKTOP-ON-A-TTY.md)).
- The forked engine is a prebuilt package the flake pins — no Chromium build
  ([how](/packages/domicile-engine/README.md#getting-one-without-building-it)).
- Keys and configuration are each desktop's own:
  [simple](/packages/shell-simple/README.md),
  [manganese](/packages/shell-manganese/README.md). Domicile has none.
- A client rendering on the GPU has its buffer composited directly, no copy. A
  client drawing in software gets a blank window: its pixels are in shared
  memory, and the engine can only take a GPU buffer. The upload that would
  convert one is not built yet
  ([why](/docs/architecture/WINDOW-COMPOSITING.md)).

A shell of your own goes on the command line, and Domicile itself is the app
that takes one: `nix run github:cprussin/domicile -- ./dist/shell.js`. See
[/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md).

## Launch an app into it

Domicile is a Wayland compositor, so an app joins the desktop by connecting to
*its* display rather than your session's — set `XDG_RUNTIME_DIR` and
`WAYLAND_DISPLAY` to the two values printed at startup in front of any Wayland
client. Each desktop also launches a terminal on a key of its own, and
everything started from that terminal lands here too:
[the long answer](/packages/shell-simple/README.md#launch-an-app-into-it).

## On NixOS

`homeManagerModules.default` describes a desk where the rest of your
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
machine's decision, not a home directory's. `settings` is freeform and the
fields are the compositor config's, which
[/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md#the-configuration) walks
through.
