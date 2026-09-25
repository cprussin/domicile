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

## Your session's keys, in a window

A desktop in a window needs the Meta key, and in your session that key is
already your compositor's. Every binding a shell claims is a Meta chord, and a
compositor matches its own bindings *before* it hands a key to the focused
client — so `Meta+Enter` opened sway's terminal and the desktop was never told
anything had been pressed.

So the desktop asks for them: while its window holds the keyboard, it requests
`zwp_keyboard_shortcuts_inhibit_unstable_v1` and your compositor stops matching
its bindings. **This is scoped to focus.** Click anything else and your keys
are yours again — the request is per seat, and the compositor drops it the
moment the window loses the keyboard.

**On sway, `bindsym --inhibited` is the way to keep one anyway.** The desktop's
window is focused for as long as you are using it, so a binding you need
*through* it — a volume key, a switch back to another workspace — has to say
so:

```
bindsym --inhibited XF86AudioRaiseVolume exec wpctl set-volume @DEFAULT_SINK@ 5%+
bindsym --inhibited Mod4+Shift+q kill
```

`seat * shortcuts_inhibitor disable` turns the whole thing off from sway's
side, and then a nested desktop has no Meta key again. Compositors that do not
implement the protocol never had one to give: the engine logs that and carries
on.

**On a bare tty none of this happens** — there is no host compositor, the
desktop *is* the compositor, and the request is not made.

## What the launcher offers

The launcher searches an index of the home, walked at startup and kept current
by a watch. What it leaves out is `[files] omit`: globs over paths relative to
the home, with gitignore's rules — `*` stops at a `/`, `**` does not, `!` takes
a path back, and the last pattern to match decides. An omitted directory is not
walked, so nothing under it can be taken back.

```toml
[files]
# Everything two deep is left out, except under Scratch.
omit = ["*/*", "!Scratch/*"]
```

- **Leaving it out omits what is hidden**, at any depth: `["**/.*"]`. A list
  that is stated replaces that, so a desk can offer its dotfiles.
- **A reload walks the home again** under the new rule; the launcher keeps its
  list until the walk corrects it.

On NixOS that is `programs.domicile.settings.files.omit`.

## The screen going dark

A desktop left alone turns its screens off — if you ask it to. Nothing blanks
by default; say how long:

```toml
[idle]
blank_after_seconds = 600
```

On NixOS that is `programs.domicile.settings.idle.blank_after_seconds = 600;`.
The screens come back on the next key, click, scroll, or movement of the
pointer.

- **Leaving the key out is a desktop whose screens never blank**, which is what
  every desk that has not been told gets.
- **`0` is refused**, by name and at startup: it reads as both "blank at once"
  and "never blank", and "never" already has a spelling.
- **A film keeps the screens on.** A player that asks the desktop to stay
  awake — `zwp_idle_inhibit_manager_v1`, which every toolkit reaches through
  its own idle-inhibit API — is obeyed for as long as it is running and its
  window is open, so a video with nobody touching the trackpad does not blank.
  The desk goes dark when the last such client lets go, closes its window or
  exits, without waiting for a hand; a player that *crashes* holding one does
  not keep the screens on, and neither does a program that asks on a window it
  never shows.

**It is not a lock.** The screens go dark and anybody can still walk up and
type; nothing asks for a password on the way back. That is open work —
[/ROADMAP.md](/ROADMAP.md).

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
      displays = [
        {
          display = "DEL DELL U3219Q 2ZLS413";
          mode = [3840 2160];
          scale = 1.2;
          transform = "rotate-270";
        }
      ];
    }];
  };
}
```

It writes the config and installs no session — booting into a desk is a
machine's decision, not a home directory's. `settings` is freeform and the
fields are the compositor config's, which
[/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md#the-configuration) walks
through.

### Naming a monitor

`display` above is a monitor's name, and it takes any of the three a monitor
answers to:

- **`drm-<id>`** — always there, an int64 off the EDID, and no use to anybody
  reading it off a desk.
- **`DEL DELL U3219Q 2ZLS413`** — the panel's own name, exactly as its EDID
  spells it: the maker in three letters, the model, the serial.
- **`Dell Inc. DELL U3219Q 2ZLS413`** — the same name with the maker spelled
  out of hwdata's `pnp.ids`, which is what sway and kanshi print. This is the
  one Domicile advertises on the `wl_output`, so it is what a "which monitor is
  this" client shows you.

**Both panel spellings match, so nothing you have written stops working.** The
three-letter form was the only one Domicile knew until recently and is still a
name it answers to; a profile written against either applies.

The table behind the longer form is hwdata's, read at run time — the flake's
wrapper points the compositor at it, so a desktop installed from this flake
has it. A compositor that finds no table names monitors the way their firmware
does and says so once at startup:

```
monitors will be named the way their EDID spells them — `DEL DELL U3219Q
2ZLS413` rather than `Dell Inc. DELL U3219Q 2ZLS413`. …
```

That is the line to look for if `Dell Inc.` is not what you see. Point
`DOMICILE_PNP_IDS` at a copy of `pnp.ids` to fix it; a `cargo run` out of a
checkout finds `/usr/share/hwdata/pnp.ids` or `/usr/share/misc/pnp.ids` by
itself.

### Stating a monitor's mode

`mode` above says which mode the rest of that entry was written for, in
physical pixels. It does **not** ask for one: Domicile does not modeset — the
engine holds DRM master and lights every connector at its native mode — so a
`mode` is something you assert about a monitor rather than something you set
on it.

It is worth asserting because a profile's positions are sums of the sizes it
places. Put a 3840x2160 monitor at `[0, 0]` and the next one at `[3200, 0]`,
and that 3200 is the first monitor's mode divided by its scale; a monitor that
comes up at 1920x1080 instead leaves a hole nobody chose, on a desk where
nothing says why. With the mode written down, that desk refuses to come up:

```
output profile desk is written for DEL DELL U3219Q 2ZLS413 at 3840x2160 and it
is scanning out 1920x1080; this desktop places a monitor at the mode it
reports and does not set one, so the profile cannot be applied as written
```

A profile that cannot be applied leaves the desktop that is up exactly as it
is — the same bargain a config that does not parse gets — so this is a
complaint to read and fix, not a desk that goes dark.

**Leave it out and nothing is checked**, which is what every profile did
before the field existed and is the right answer for a profile whose displays
sit at the origin or in one row left to right, where no position depends on a
size.

**It is a size, not a size and a rate.** kanshi pins `3840x2160@60Hz`; the
hertz is the half that changes none of the arithmetic above, and a monitor
that reports no rate at all is ordinary rather than broken — asserting one
would refuse desks that work.
