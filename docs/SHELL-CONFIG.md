# The config file

One JSON file (or a module that builds it) describes a desktop: displays,
keyboard, idle, lock, lockdown, theme and extensions. The compositor reads it at startup
and reloads it on every change. The schema is the `domicile-config` crate's.

For what a shell does with these settings, see
[WRITING-A-SHELL.md](WRITING-A-SHELL.md).

## Where it is

- `domicile --config ./desk.json ./my-desktop/dist/shell.js` names it. The flag
  can go before or after the shell.
- Without the flag, `domicile` looks for
  `$XDG_CONFIG_HOME/domicile/domicile.{ts,tsx,js,mjs,json}` (or
  `~/.config/domicile/` if `XDG_CONFIG_HOME` is unset). Two matches is an
  error.
- With no config file, the compositor uses its defaults: one output that
  follows the engine's window (suits a nested dev run).
- `--config` with no value, or given twice, is an error.
- `domicile` prints which config it used before starting:

```
config: /home/you/.config/domicile/domicile.json, found where a config lives
config: ./desk.json, because --config names it
config: none -- no domicile.{ts,tsx,js,mjs,json} in /home/you/.config/domicile -- so the compositor's defaults
```

`domicile-compositor` itself reads nothing from the environment. It takes every
value on its command line. The lookup above is the `domicile` binary's.

## A config module

A `.ts`, `.tsx`, `.js` or `.mjs` config is evaluated to JSON.

- The `Shell` export is the shell to run when none is given.
- In a JSON config, name the shell with `"shell"`, relative to the config
  file: `{ "shell": "@domicile-desktop/manganese" }`.
- Every other export is a top-level section of the schema.

```tsx
// ~/.config/domicile/domicile.tsx
import { runManganese } from "@domicile-desktop/manganese";

export const input = { keyboard: { xkb_variant: "dvp" } };
export const Shell = runManganese();
```

- Styling custom manganese bar items:
  [CUSTOM-BAR-ITEMS.md](/packages/shell-manganese/docs/CUSTOM-BAR-ITEMS.md).
- Design: [COMPOSABLE-SHELLS.md](/docs/architecture/COMPOSABLE-SHELLS.md).

## Home-manager

`programs.domicile` has an option for every schema field:

```nix
{
  imports = [domicile.homeManagerModules.default];

  programs.domicile = {
    enable = true;
    shell = "${domicile.packages.${system}.manganese}/shell.js";
    settings.output.profiles = [{
      name = "desk";
      displays = [
        {display = "DEL DELL U3219Q 2ZLS413"; scale = 1.2; transform = "rotate-270";}
      ];
    }];
  };
}
```

- It writes the config to the standard path and puts `domicile` on `PATH`
  with your shell set.
- It installs no login session. That is the NixOS module's job
  ([RUNNING-A-DESKTOP.md](/docs/RUNNING-A-DESKTOP.md#the-machines-half)).
- `settings` is freeform, so keys newer than the module pass through.
- The build runs `domicile check-config` on the file, so a key the compositor
  refuses fails `home-manager switch` instead of the desk. Run it yourself on
  a hand-written config: `domicile check-config ~/.config/domicile/domicile.json`.

## Reloading

An edit applies to the running desktop, and windows stay open:

| Section | Effect of an edit |
|---|---|
| `input.keyboard` | New layout; moves the keys a shell bound ([Keybindings](WRITING-A-SHELL.md#keybindings)) |
| `output.max_scale` | Re-advertised to clients |
| `output.displays`, `output.profiles` | Displays rearranged |
| `idle.blank_after_seconds` | Idle timer restarts. Dark screens relight |
| `theme.mode` | Shell and windows repaint |
| `theme.accent_color`, `contrast`, `reduced_motion` | Shell and windows that read the settings portal follow |
| `theme.icon_theme` | Shell and windows that read the settings portal follow; tray icons redrawn and later notifications drawn in it; manganese on the next menu or launcher opening, and title bars when a new app id appears |
| `files.omit` | Launcher file index rebuilt |
| `extensions` | Extensions installed or removed ([EXTENSIONS.md](/docs/architecture/EXTENSIONS.md)) |
| `lockdown` | Applications told through the Lockdown portal |

- `lock` and `startup` are read only at startup. Rerunning `startup` would
  duplicate its commands.
- A file that fails to parse is rejected and logged. The last good config
  stays.
- A keyboard xkb cannot compile is rejected and logged. The current layout
  stays.

## Other sections

- `startup.commands`: commands run once when the compositor starts. Each is an
  argv: `[["emacs", "--daemon"], ["sh", "-c", "…"]]`.
- `files`: what the launcher's file index leaves out. See
  [LAUNCHER.md](LAUNCHER.md).
- `output.max_scale`: the highest scale advertised for the output that
  follows Domicile's window. Applies only when `output.displays` is empty.
  Default `2`; `1` turns scaling off.

## Keyboard

`input.keyboard` takes sway's `xkb_*` fields: `xkb_layout`, `xkb_variant`,
`xkb_options` and the rest. The default is plain `us`, no variant, no options.
A shell for users of other layouts must set them here; nothing else does.

## Idle

`idle.blank_after_seconds` is how long the desktop goes without input before
the screens turn off. Any key, click, scroll or pointer motion turns them back
on.

- Unset means the screens never blank. `0` is an error.
- The same timeout locks the desktop if `lock` is set.
- Apps can block blanking (for example, during a video) with
  `zwp_idle_inhibit_manager_v1`. This involves only the app and the
  compositor.
- Shell side: [SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md#idle).
  Implementation: [IDLE.md](IDLE.md).

## Lock

Set one of these to enable locking. Setting both is an error, and neither may
be empty.

- `lock.pam_service`: a PAM service that checks the desktop user's password.
- `lock.passphrase`: a fixed string. On NixOS the config, and so the
  passphrase, is in the world-readable Nix store. It protects against someone
  at the keyboard, not someone who can read the disk.

Shell side: [SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md#locking).
Implementation: [LOCK.md](LOCK.md).

## Lockdown

```json
{ "lockdown": { "disable_camera": true, "disable_printing": true } }
```

Switches that ask applications not to do something. The compositor reports
them through the `org.freedesktop.impl.portal.Lockdown` portal; applications
that read it enforce them. Every switch defaults to `false`.

- `disable_printing`, `disable_save_to_disk`, `disable_application_handlers`
- `disable_location`, `disable_camera`, `disable_microphone`,
  `disable_sound_output`

An application that ignores the portal is not stopped.

## Theme

```json
{ "theme": { "mode": "light" } }
```

`theme.mode` is `"dark"` or `"light"`. There is no `"system"` value, because
this config is the system setting. `"system"` is rejected.

Applications read the rest through the settings portal
(`org.freedesktop.appearance`), and the shell receives them too:

| Key | Values | Default |
|---|---|---|
| `theme.accent_color` | `"#rrggbb"` | unset: each application's own |
| `theme.contrast` | `"normal"`, `"high"` | `"normal"` |
| `theme.reduced_motion` | `true`, `false` | `false` |
| `theme.icon_theme` | an icon theme's directory name, such as `"Papirus-Dark"` | unset: `hicolor` only |

`icon_theme`:

- Served as `org.gnome.desktop.interface`'s `icon-theme`. Unset leaves it to
  the next portal backend; a reload that unsets it signals `hicolor`.
- Install the theme so it is under a data directory's `icons`, such as
  `~/.nix-profile/share/icons`.
- Shells read it with `watchIconTheme` from `@domicile-desktop/sdk/icon-theme`
  and look icons up with `@domicile-desktop/system-apps/app-icons`.

In manganese:

- `accent_color` replaces the `accent` token in both themes.
- `contrast: "high"` draws text at the palette's ends and darkens borders and
  muted text.
- `reduced_motion` runs every animation and transition once at the shortest
  duration: wallpaper crossfades, the theme wipe, window animations.
- `icon_theme` draws tray menu, launcher and title bar icons. Symbolic icons take the
  text's color. It is followed once per desktop; a theme that cannot be read
  is logged and drawn as `hicolor`.

Shell side: [SHELL-DESKTOP-EVENTS.md](SHELL-DESKTOP-EVENTS.md#theme).

## Displays

`output` has two ways to describe displays:

- **`output.displays`** lists the desktop's displays outright: name, size,
  position and scale. Use it for nested runs, where there are no monitors to
  detect.
- **`output.profiles`** arranges the monitors that are plugged in. The first
  profile whose displays are all connected applies. Matching reruns on every
  hotplug and reload.

```json
{
  "output": {
    "profiles": [
      {
        "name": "desk",
        "displays": [
          { "display": "drm-1", "enabled": false },
          {
            "display": "DEL DELL U3219Q 2ZLS413",
            "mode": [3840, 2160],
            "position": [0, 0],
            "scale": 1.2,
            "transform": "rotate-270"
          }
        ]
      },
      { "name": "laptop-only", "displays": [{ "display": "drm-1", "scale": 1.5 }] }
    ]
  }
}
```

Each profile entry sets `enabled`, `position`, a fractional `scale`, a
`transform`, and optionally `mode`.

### Naming a display

Any of these match:

- the `wl_output` name, `drm-<id>` on a tty
- the EDID description `"<MAKE> <MODEL> <SERIAL>"`, e.g.
  `DEL DELL U3219Q 2ZLS413`
- the description with the maker's full name from hwdata's `pnp.ids`, e.g.
  `Dell Inc. DELL U3219Q 2ZLS413`, as kanshi and sway use

A monitor with no EDID make, model or serial has an empty description.

### `mode`

`mode` is a check. Domicile does not modeset: the engine lights every
connector at its native mode. A profile's `mode` (a size, no refresh rate)
states the mode its positions assume. If the monitor comes up at a different
mode, the profile does not apply, the current layout stays, and the log names
both modes. Omit `mode` to skip the check.

### `transform`

`transform` uses `wl_output` values, which count counterclockwise, as in
kanshi and sway. `rotate-90` is for a monitor turned a quarter clockwise;
`rotate-270` the other way.

More: [DISPLAYS.md](DISPLAYS.md) and [RUNNING-A-DESKTOP.md](RUNNING-A-DESKTOP.md).

## Extensions

See [SHELL-EXTENSIONS.md](SHELL-EXTENSIONS.md#the-config).
