# Running a desktop

How to run, install and configure a Domicile desktop. You need Nix and either a
Wayland session or a console login.

```sh
nix run github:cprussin/domicile/stable#manganese   # tiling, sway's keys, address bar
nix run github:cprussin/domicile/stable#simple      # floating windows only
```

- `stable` is the newest `main` built with the production engine (PGO, ThinLTO,
  no DCHECKs). After an engine change, `main` uses a slower checked build until
  the nightly build is pinned. `stable` waits for that pin. Drop `/stable` to
  run `main`.
- Each desktop is its own app. Install one with `nix profile install`.
- In a Wayland session the desktop opens in a window. On a console login it
  takes the screen; no setting is needed
  ([how](/docs/architecture/A-DESKTOP-ON-A-TTY.md)).
- The flake pins a prebuilt engine, so you do not build Chromium
  ([how](/packages/domicile-engine/README.md#using-a-prebuilt-engine)).
- Each desktop documents its own keys and settings:
  [simple](/packages/shell-simple/README.md),
  [manganese](/packages/shell-manganese/README.md).
- Clients that draw in software are copied into a GPU buffer. This path is
  untested on real GPUs ([status](/ROADMAP.md)).
- To run your own shell: `nix run github:cprussin/domicile/stable -- ./dist/shell.js`.
  See [WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md).

Settings live in `~/.config/domicile/domicile.json` (or `.ts`/`.js`). Reference:
[SHELL-CONFIG.md](SHELL-CONFIG.md).

## Launch an app into it

- Domicile prints `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY` at startup. Set both
  to start any Wayland client on the desktop.
- `simple`: Alt+Enter opens a terminal. More:
  [shell-simple](/packages/shell-simple/README.md#launch-an-app-into-it).
- manganese has no launch binding by default. Add one that `exec`s your
  launcher or terminal.
- Apps started from the desktop's terminal or launcher run on the desktop.
- `startup.commands` lists programs to start with the desktop, each as an argv.
  They run once at startup, not on reload.

```json
{ "startup": { "commands": [["emacsclient", "-e", "t"], ["sh", "-c", "mako >/dev/null"]] } }
```

### Each app gets its own scope

- A desktop that is the login session starts each app it launches (keys,
  launcher, `startup.commands`, the portal's mail client) through
  `systemd-run --user --scope`, in `app.slice`, named
  `app-domicile-<program>-<random>.scope`.
- The desktop stays in the login session's cgroup and the apps move to the
  user manager's. The kernel shares CPU between those before it looks at nice
  values, so a build in a terminal cannot take the desktop's share.
- This needs `systemd-run` on `PATH` and a systemd user manager on the session
  bus. Without one, the launcher says so and apps start in the desktop's
  cgroup. A nested desktop leaves its apps to the host session.
- An app's own children stay in its scope: `systemctl --user status` shows them
  under it.

### Links open on the desktop

- Apps get `BROWSER=domicile-open-url`, which opens the URL in a desktop
  browser window.
- Apps get Domicile's `xdg-open` first on `PATH`. It opens web links on
  the desktop and passes everything else to your own `xdg-open`.
- GTK apps (via GIO) read `domicile-mimeapps.list`, which Domicile puts first
  on `XDG_DATA_DIRS`. A browser you set in your own `mimeapps.list` still
  wins.
- A desktop that is the login session starts `domicile-session.target`, so the
  portal runs. Through it, Flatpak apps open links on the desktop and get the
  theme.
- `domicile open-url <url>` does the same from a terminal on the desktop.
  `domicile open-app <url>` opens it as an app, without an address bar
  ([WEB-APPS.md](architecture/WEB-APPS.md)).

## Screenshots

Run these from a terminal on the desktop. Both are refused while the desk is
locked.

- **`domicile screenshot`** opens the shell's screenshot picker, as the
  shell's screenshot key does (Print in manganese). Pick a monitor, a window
  or an area. The PNG goes under `$XDG_PICTURES_DIR/Screenshots/` and its path
  is printed. Dismissing the picker prints
  `domicile: the screenshot was canceled` and exits 1. It waits as long as
  the picker is open. With a shell that answers no portal requests, it waits
  until the desktop exits, and Ctrl-C does not withdraw the request.
- **`domicile screenshot <file>`** writes a PNG of the whole desk, every
  monitor at the highest density, to `<file>` and prints its path.

## Shell commands

`domicile send-shell <word>…` runs a shell command from a terminal on the
desktop, as a keybinding bound to it does. `domicile send-shell focus right`
moves focus right in manganese, like Meta+l.

- Every word after `send-shell` is the command. The shell's README lists its
  commands; manganese's are in [KEYS.md](../packages/shell-manganese/docs/KEYS.md#commands).
- Every page of the desktop hears it.
- It fails when no page listens for commands, and while the desk is locked.
- It exits 0 once the pages have the command. The shell does not report
  whether it knew it.

## Host shortcuts in a window

A nested desktop needs the Meta key, which your host compositor also uses.

- While the desktop's window has keyboard focus, it requests
  `zwp_keyboard_shortcuts_inhibit_unstable_v1`. The host then passes its key
  bindings through to the desktop.
- When the window loses focus, the host's bindings work again.
- On sway, mark bindings you need while the desktop is focused with
  `--inhibited`:

```
bindsym --inhibited XF86AudioRaiseVolume exec wpctl set-volume @DEFAULT_SINK@ 5%+
bindsym --inhibited Mod4+Shift+q kill
```

- `seat * shortcuts_inhibitor disable` turns inhibiting off in sway. The
  nested desktop then gets no Meta chords.
- A host without the protocol keeps its bindings. The engine logs this.
- The inhibitor covers keys only. sway's `floating_modifier` drag still moves
  the desktop's own window. Use another modifier in sway, such as
  `floating_modifier Mod1 normal`, to drag windows inside the desktop.
- On a console login there is no host, so none of this applies.

## The launcher

The launcher searches files in your home, desktop entries and bookmarks.
Configure it with `files.omit` and manganese's `applications` option:
[LAUNCHER.md](LAUNCHER.md).

## Blanking and locking

```json
{ "idle": { "blank_after_seconds": 600 }, "lock": { "pam_service": "domicile" } }
```

- Screens turn off after `idle.blank_after_seconds` without input. Unset never
  blanks. `0` is an error.
- Apps playing video can keep the screens on.
- Set `lock.pam_service` or `lock.passphrase` (not both) to lock the desktop
  when the screens go dark.
- `lock.pam_service` needs the machine to declare the PAM service: use the
  [NixOS module](#the-machines-half) or add
  `security.pam.services.domicile = {};`. A home-manager module cannot. If the
  service is missing, Domicile does not start and names the line to add.
- `lock.passphrase` is world-readable in the Nix store. It only stops someone
  at the keyboard.
- `lock` is read at startup. Changes apply on the next run.

Reference: [idle](SHELL-CONFIG.md#idle), [lock](SHELL-CONFIG.md#lock). Design:
[IDLE.md](IDLE.md), [LOCK.md](LOCK.md). Open work: [ROADMAP.md](/ROADMAP.md).

## On NixOS

`homeManagerModules.default` writes the config and sets the shell. It
installs no login session and no PAM service; those are the
[machine's half](#the-machines-half). See
[SHELL-CONFIG.md](SHELL-CONFIG.md#home-manager) for its options, and
[SHELL-CONFIG.md](SHELL-CONFIG.md#displays) for monitor profiles.

### The machine's half

`nixosModules.default` goes in the system configuration:

```nix
{
  imports = [domicile.nixosModules.default];

  programs.domicile.enable = true;
  services.displayManager.defaultSession = "domicile";
}
```

It provides:

- **The `domicile` login session.** It runs the shell your config names, so one
  session serves every desktop. Without the module,
  `services.displayManager.sessionPackages = [domicile]` adds it.
- **The `domicile` PAM service**, for `lock.pam_service = "domicile"`.
- **The `domicile` group.** Its members' login sessions may lower nice values
  to -10 and use realtime priority 8. The engine asks for nice -8 on the
  threads that draw and present frames, so animations stay smooth while the
  machine is busy. Add yourself with
  `users.users.<you>.extraGroups = ["domicile"]` and log in again.
- **UPower**, which the battery readout reads. Without it, manganese shows no
  battery. Set `services.upower.enable = false` to opt out.
- **`domicile-session.target`**, started by a desktop that is the session. User
  services bound to `graphical-session.target` and `~/.config/autostart`
  entries start with it. The package is also on the system profile, so the
  portal finds `domicile-mimeapps.list`.
- **Portal routing**, when `xdg.portal.enable` is set. Domicile is the only
  backend and the shell draws every dialog. `domicile-portals.conf` sends
  `Secret` to `gnome-keyring`, which you install (`oo7-portal` works too).
  The home-manager module offers the same for home-manager's `xdg.portal`.

It does not enable a display manager or set the default session.
