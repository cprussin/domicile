# The `domicile` command

`domicile` runs a desktop, and sends commands to the one running.
`domicile --help` lists them. Commands for the running desktop work from any
terminal on it.

## `domicile [shell]`

Run a desktop.

```sh
domicile                                  # the shell your config names
domicile @domicile-desktop/manganese      # manganese
domicile ./shell.tsx                      # a shell entry, built for you
domicile ./dist/shell.js                  # a built shell
domicile ./shell.js --config ./desk.json  # with another config file
```

- With no shell, it runs the one the config names: a JSON config's `"shell"`,
  or a config module's `Shell` export.
- The config is `~/.config/domicile/domicile.{ts,tsx,js,mjs,json}` unless
  `--config` names one. On a terminal, it prints which it used.
- A `.ts`, `.tsx` or a `.js` with bare imports is built first, with React and
  `@domicile-desktop/*` from Domicile's install. So are npm and `github:`
  packages ([SHELL-PACKAGING.md](SHELL-PACKAGING.md#distributing)).
- In a Wayland session it opens in a window; from a console login it takes
  the screen.

## `domicile which-shell`

Print the shell the running desktop serves.

## `domicile load-shell <shell>`

Serve another shell, or a new build of the same one. Windows stay open. It
takes the same forms as `domicile [shell]`.

- A failed build prints the error and keeps the running shell.
- A shell that fails to run (it will not load, has no `Shell`, or `Shell`
  throws) prints why, and the desktop goes back to the shell it had.
- A module rebuilt in place has no old shell to go back to, so it stays on its
  error screen.

## `domicile dev <entry>`

Serve a shell from its source, with hot module replacement, until Ctrl-C.
Then the desktop goes back to the shell it replaced. `<entry>` is the file the
shell's source starts at, such as `src/shell.tsx`
([WRITING-A-SHELL.md](WRITING-A-SHELL.md#hot-module-replacement)).

- An edit Vite can apply in place keeps the page's state. Any other edit
  reloads the shell, and windows stay open, as with `load-shell`.
- The dev server's log, such as each update it sends, prints in this
  terminal.
- A failed build or a dev server that stops prints why, and the desktop goes
  back to the shell it replaced.

## `domicile open <file|folder|url>`

Open a file or folder with its type's default app, or a link in a browser
window ([LAUNCHER.md](LAUNCHER.md#opening-files)).

- `domicile open --profile <id> <url>` opens a link in browser profile `<id>`
  ([BROWSER-PROFILES.md](architecture/BROWSER-PROFILES.md)). Without it, a
  link opens in the profile its site opens in. A profile the config doesn't
  name is an error.
- `domicile open --app <url|module>` opens a site or an app module as an
  app: its own window, without an address bar
  ([WEB-APPS.md](architecture/WEB-APPS.md)).
  - `--id <id>` makes a site's window app `<id>`'s.
  - `--profile <id>` opens a new window in that browser profile rather than
    its site's.
  - `--reuse focus` brings `<id>`'s open window to the front instead of
    opening another; `--reuse navigate` also loads the address in it. Both
    need `--id`. `new`, the default, always opens a window.
- `domicile open --which <file|url>` prints the app `open` would use.
- `domicile open --electron <entry|path> [-- <command>...]` runs an installed
  Electron app on the desktop's engine instead of the Electron it ships:
  `domicile open --electron slack.desktop`. `<entry>` is a desktop entry id;
  `<path>` is the app's install or its program. `<command>` is the app's own
  command line, which runs it on its own Electron, with a notification, if a
  page needs what the engine doesn't do yet
  ([ELECTRON-APPS.md](architecture/ELECTRON-APPS.md)).
- Apps on the desktop run it for `xdg-open` and `$BROWSER`.

## `domicile install-app <url>`

Add a site to your applications, named and drawn from its web app manifest.
It opens with `domicile open --app`.

## `domicile uninstall-app <url>`

Remove a site `install-app` added, given the same address.

## `domicile screenshot [file]`

With no file, open the shell's screenshot picker. The picture goes in
`Pictures/Screenshots` and its path is printed; Ctrl+C in the picker copies
it instead. With a file, write every monitor to it as a PNG, without asking.
Exits 1 if the picker is dismissed.

## `domicile screenshot --fit <px> <file>`

Write a PNG of every monitor to `<file>`, shrunk so neither side is over
`<px>` pixels, without asking. Print what it shows as JSON: the desktop it
covers in logical pixels, and its size.

```
$ domicile screenshot --fit 1280 desk.png
{"place":{"position":[0,0],"size":[3840,1080]},"width":1280,"height":360}
```

A point in the PNG is a point for `pointer`, scaled by `place.size` over
`width` and `height`.

## `domicile pointer <x>,<y> [click|double-click|right-click|middle-click|press|release]`

Move the pointer to `<x>,<y>`, in logical pixels from the desk's top-left
corner, then click or press the left button there, or click the right or
middle one. `press` and `release` with moves between them drag.

## `domicile scroll <dx>,<dy>`

Scroll where the pointer is, in logical pixels: positive is right and down.

## `domicile key <chord>`

Press the keys of a chord in order, then release them in reverse. Each key is
an XKB keysym name, such as `Return`, `Tab`, `l` or `F4`, in any case;
`ctrl`, `shift`, `alt` and `super` name the left modifiers.

```
domicile key ctrl+shift+Tab
```

## `domicile type <text>`

Type `<text>` on the desk's keyboard, holding Shift where a character needs
it. Refused, typing nothing, when no key types a character without AltGr.

## `domicile devtools <window> <method> [params]`

Send one [DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
method to a browser window's page, with its params as a JSON object, and print
its result as JSON. `<window>` is an id `list-windows` prints. `domicile mcp`
drives browser windows with it.

```
$ domicile devtools Xy7pQ2mN8vB4cZ1kL6tR9wF3hD5sJ0gE DOM.getContentQuads '{"backendNodeId":42}'
{"quads":[[10,20,110,20,110,40,10,40]]}
```

Only the methods an agent needs to read and drive a page go through:
`Accessibility.getFullAXTree`, `getPartialAXTree` and `queryAXTree`;
`DOM.focus`, `getBoxModel`, `getContentQuads` and `scrollIntoViewIfNeeded`;
`Input.dispatchKeyEvent`, `dispatchMouseEvent` and `insertText`; and `Page.captureScreenshot`,
`getLayoutMetrics`, `getNavigationHistory`, `navigate` (to http and https
only), `navigateToHistoryEntry` and `reload`. Nothing reads cookies or
storage or runs script. Private windows and native windows are refused. A page
that does not answer in 10 seconds is refused too.

## `domicile screen-record`

Open the shell's screen cast picker and record what is picked, with its sound,
until the toolbar's Stop. The video goes in `Videos/Screen recordings` and its
path is printed. Exits 1 if it is dismissed or discarded.

## `domicile send-shell <word>...`

Run a shell command, as a keybinding bound to it does:
`domicile send-shell workspace 2`. Manganese's commands are in
[KEYS.md](/packages/manganese-window-management/docs/KEYS.md#commands), and
`list-shell-commands` prints whichever shell is running's. It fails, with the
shell's reason, when no page listens for commands, when every page refuses
the command (an unknown command or a wrong argument), or when none says it ran
it within a second.

A command may answer, and `send-shell` prints the answer. Manganese's queries
answer with JSON, as `swaymsg -t get_workspaces` and `get_tree` do:

```
domicile send-shell get-workspaces | jq '.[] | select(.visible) | .name'
domicile send-shell get-tree
```

## `domicile list-shell-commands [--json]`

Print the commands `send-shell` takes, as the running shell describes them,
each with what it does. `send-shell --help` prints the same.

```
focus left|right|up|down  Move focus to the neighboring window.
workspace <name>          Show workspace <name>, creating it if needed.
```

A shell describes its commands when it listens for them (`bindKeys`'s
`commands`; see
[WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md)). `--json` prints the array of
`{usage, description}` instead, for scripts.

## `domicile list-bindings [--json]`

Print the running shell's keys and gestures in each binding mode, and what
each runs.

```
default
  Meta+Left    send-shell focus left
  Meta+r       mode resize

resize
  Escape       mode default
```

Chords are in one spelling (`Shift+Meta+l` prints as `Meta+Shift+l`).
`--json` prints the array of `{mode, chord, action}` instead, for scripts.

## `domicile theme [light|dark|toggle]`

Set the theme until the desktop restarts, or print it. Set `theme.mode` in
the config to keep one.

## `domicile sleep-displays [display]`

Turn every monitor off now. Windows, workspaces and the layout stay as they
are, and programs keep running. A key, a click or a pointer move lights them
again, as does `wake-displays`. Input in the first second is ignored, so
letting go of Enter or of the keybinding that ran it does not undo it. In
manganese, bind `exec domicile sleep-displays`.

With a display, by any name a profile matches it by (its connector `eDP-1`,
its panel `BOE NE135A1M-NY1`, or its output name `drm-12345`), turn only that
one off. A name no display, or more than one, answers to fails, listing every
display's names. It keeps its windows and workspace, the pointer does not
enter it, and it stays off through input until `wake-displays` names it or
names none. See
[IDLE.md](IDLE.md#sleeping-on-demand).

## `domicile wake-displays [display]`

Turn the monitors back on, after `sleep-displays` or idle blanking, or only
the display named. For a script, or over SSH.

## `domicile list-displays [--json]`

Print each display: every name `sleep-displays` and a display profile take for
it, its mode, its size and position in logical pixels, scale, rotation, HDR,
adaptive sync, and whether it is lit or off.

```
drm-1 (lit)
  names     drm-1, eDP-1, BOE NE135A1M-NY1
  mode      2256x1504 @ 59.999 Hz
  layout    1128x752 at 0,0, scale 2, normal
  color     HDR unsupported, adaptive sync off
```

`--json` prints a JSON array instead, for scripts: each display's fields as
shells get them in `domicile.displays`, plus `names` and `lit`.

## `domicile configure-display <display> <change>...`

Change a monitor until the desktop restarts, like `swaymsg output`: the
config file is left alone, and editing it later keeps these changes over it.
The display is any name `list-displays` prints or a profile matches. The
changes, in any order:

- `mode <W>x<H>[@Hz]`: a mode the monitor offers, like `2560x1440@144`.
- `scale <S>`: like `1.25`.
- `position <X>,<Y>`: its top-left corner in logical pixels, like `1920,0`.
- `transform normal|90|180|270`: content turned counterclockwise, as in a
  profile.
- `adaptive-sync on|off`, `hdr on|off`, `sdr-white <nits>`.
- `enable` or `disable`: light it, or turn it off and leave it out of the
  desktop.
- `reset`: drop this monitor's earlier changes, back to the config. Changes
  after it on the same line still apply.

```sh
domicile configure-display DP-1 mode 2560x1440@144 scale 1.25 position 1920,0
domicile configure-display eDP-1 disable
domicile configure-display eDP-1 reset
```

It changes the profile that matches the plugged-in monitors, as
[DISPLAYS.md](DISPLAYS.md) describes. With no matching profile, it starts one
of every plugged-in monitor at its defaults. A change that makes a profile the
config would refuse, such as turning off the last monitor, is refused and
changes nothing. A config that describes the desktop with `output.displays`
sets its monitors there, so this refuses them.

## `domicile list-windows [--json]`

Print each window: native windows in the order they opened, then the browser
and app windows.

```
ID                                KIND     APP    PID   SIZE     TITLE
kD3mQ7nW1zT5yB8vC2xF6hJ9pL4sR0gA  native   emacs  4242  640x480  notes.org (focused)
Xy7pQ2mN8vB4cZ1kL6tR9wF3hD5sJ0gE  browser  mail   -     -        Inbox (private)
```

- `ID` is the window's `ext-foreign-toplevel-list-v1` identifier, which
  capture tools see too.
- `APP` is a native window's desktop entry id, or an app window's id.
- `focused` marks the native window with the keyboard. The shell's page holds
  the keyboard for browser windows, so none is marked.
- `urgent` marks a window that asked for the keyboard and was refused.
- `private` marks a private browser window.

`--json` prints a JSON array instead, for scripts, with `kind`, `title`,
`app`, `pid`, `size`, `focused`, `urgent`, `url` (a browser window's address,
`null` for a native window), `private` and `engine_id` (a browser window's
id in the engine, `null` for a native window) per window.

## `domicile list-inputs [--json]`

Print each keyboard, pointer and touch device the desktop reads, in the order
it found them.

```
ID  KIND         CONNECTION  VENDOR:PRODUCT  NAME
4   keyboard     internal    0001:0001       AT Translated Set 2 keyboard
9   mouse        bluetooth   046d:4082       Logitech MX Master 3
11  touchpad     internal    -               SYNA8004:00 06CB:CD8B Touchpad
```

- `ID` holds while the device stays plugged in. A device that is two kinds,
  like a keyboard with a touchpad, is one row per kind under one id.
- `KIND` is `keyboard`, `mouse`, `touchpad`, `touchscreen`, `pointing-stick`,
  `tablet`, or `other` for one read only for its keys or switches, like a
  power button.
- `CONNECTION` is `internal`, `usb`, `bluetooth` or `unknown`.
- `VENDOR:PRODUCT` are its USB or Bluetooth ids, as `lsusb` prints them, or
  `-` when it has none.

`--json` prints a JSON array instead, for scripts, with `id`, `name`, `kind`,
`connection`, `sys_path` (its device under `/sys`, or empty), `vendor` and
`product` per device.

## `domicile lock`

Lock the desktop now, as its lock timeout does. The compositor owns the lock,
so this works with any shell that draws a lock screen.

## `domicile focus-window <id>`

Ask the shell to show and focus the native window `id`, as `list-windows`
prints it. This is the request a window makes for itself when it wants
attention, so the shell decides: Manganese switches to its workspace.

## `domicile close-window <id>`

Ask the native window `id` to close, as its close button does. The app may
ask first, for example about unsaved work.

## `domicile kill-window <id>`

Kill the process of the native window `id` with `SIGKILL`, for an app that no
longer answers. Every window of that process goes with it, and for an X11 app
that is `xwayland-satellite` and every X11 window.

`focus-window`, `close-window` and `kill-window` take only native windows.
The shell shows and closes browser windows.

## `domicile inhibit-idle -- <command>...`

Run a command and keep the screens on, and the desktop unlocked, until it
exits, like `systemd-inhibit --what=idle`. It exits as the command does.

```
domicile inhibit-idle -- rsync -a ~/photos backup:photos
```

The shell lists the command's program among what holds the desktop awake, as
`status` does. `--` is optional unless the command's own first word starts
with `-`.

## `domicile subscribe [windows|displays|inputs|status]...`

Print what `list-windows --json`, `list-displays --json`, `list-inputs --json`
and `status --json` would, as one JSON line each, then a topic's line again
whenever its answer changes, until stopped. With no topic, every one.

```
$ domicile subscribe windows | jq -c '.windows | map(.title)'
["notes.org"]
["notes.org","Inbox"]
```

Each line is the compositor's message, its `type` saying which topic it
answers: `window_list` (with `windows`), `display_list` (`displays`),
`input_list` (`inputs`) or `status` (the fields of `status --json`'s
`status`). A line is sent only when it differs from the last for its topic.
Most changes arrive at once; what holds the screens on or captures the
desktop may take up to five seconds. It ends when the desktop does.

## `domicile status [--json]`

Print how the desktop is: the shell it serves, theme, keymap, whether it is
locked, whether the screens are off, what keeps them on (idle inhibitors), and
what records or controls it (screen casts, recordings, remote desktop, input
capture).

```
shell       /nix/store/…/shell.js
theme       dark
keymap      dvorak
locked      no
screens     lit
held awake  Firefox
capturing   -
```

`--json` prints `{"shell": …, "status": {…}}` instead, for scripts.

## `domicile disable-while-typing [on|off|toggle]`

Set whether a touchpad ignores the pointer while you type, or print it. On by
default, and on again when the desktop restarts. A desktop in a window
refuses it: the host reads the touchpad.

## `domicile monitor <name> <W>x<H>[@Hz] [scale]`

Add a monitor with no screen, like a pane of another program the desktop is
shown in, and print its output (`virtual-1`). Each line read from stdin,
like `1024x768` or `1024x768@30`, resizes it in place: its windows stay. It
is removed when stdin ends. Exits 1 if the desktop takes it away first. Only a
desktop on a tty or headless has monitors to add to
([A-HEADLESS-DESKTOP.md](architecture/A-HEADLESS-DESKTOP.md)). 60 Hz and
scale 1 unless given. A line may give a scale too, like `3840x2160 2`.

## `domicile power-off`

Ask in Domicile's dialog, then turn the computer off.

## `domicile reboot`

Ask, then restart the computer.

## `domicile log-out`

Ask, then end the login session.

## `domicile mcp`

Serve the [Model Context Protocol](https://modelcontextprotocol.io) on stdin
and stdout, so an agent can drive the running desktop. Add it to Claude Code
with:

```
claude mcp add domicile -- domicile mcp
```

Each tool runs a verb and answers what it printed, or its error:

| Tool | Runs |
|---|---|
| `list_windows`, `list_displays`, `list_inputs`, `status`, `list_shell_commands`, `list_bindings` | that verb with `--json` |
| `send_shell` | `send-shell <words>...` |
| `open` | `open [--app] [--profile <id>] <target>` |
| `focus_window`, `close_window` | that verb with the window's id |
| `theme` | `theme [light\|dark\|toggle]` |
| `screenshot` | `screenshot --fit 1280 <file>`, answered as the PNG |
| `click`, `move_pointer`, `drag` | `pointer`, with the point scaled from the last screenshot's pixels to the desk's |
| `scroll` | `pointer`, then `scroll` |
| `key`, `type_text` | `key <chord>`, `type <text>` |
| `browser_snapshot` | `devtools <window> Accessibility.getFullAXTree`, answered as an outline of the page, one element a line with its ref |
| `browser_click` | `devtools` scrolling the element into view, finding its box, and clicking its middle |
| `browser_type` | `devtools` focusing the element, if given a ref, then `Input.insertText` |
| `browser_key` | `devtools` pressing and releasing Enter, Tab, Escape, an arrow or another named key |
| `browser_navigate` | `devtools <window> Page.navigate` |
| `browser_screenshot` | `devtools <window> Page.captureScreenshot`, answered as a WebP |

The browser tools work on a window the desk hides and need no screenshot, so prefer them for browser windows. Tools the lock refuses are refused while the desktop is locked.

## `domicile check-config <file>`

Check a config file without a desktop. Exits non-zero with the reason the
compositor would refuse it. home-manager runs it on the file it writes.

## `domicile help`

Print the commands. `--help` and `-h` do the same, also after a verb, except
that `send-shell --help` prints the shell's own commands.

## `domicile --version`

Print the version, the commit it was built from, and the engine.

```text
domicile 1.2.0
commit   144a93c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7
engine   s2ffe1826ced0, checked build of Chromium 7703634 at 246fa60eff4e, built 2026-11-15T09:12:44Z
```

- The first two lines are `libexec/domicile/version`, which the flake and the
  distribution packages write.
- The engine line is from its release's `PROVENANCE`.
- A missing file fails, naming it.

Any other flag before or after a shell is refused rather than taken as the
shell.

## While locked

`screenshot`, `screen-record`, `send-shell`, `focus-window`, `close-window`,
`kill-window`, `pointer`, `scroll`, `key`, `type` and `devtools` are refused while the
desktop is locked, as is adding a `monitor`. `theme`, `sleep-displays`,
`wake-displays`, `lock`, `inhibit-idle`, `list-displays`, `list-windows`,
`list-inputs`, `status`, `subscribe`, `configure-display`,
`list-shell-commands` and `list-bindings` work, and a `monitor` added before keeps resizing.

## Environment

`DOMICILE_ENGINE_ARGS` adds switches to the browser engine
([RUNNING-A-DESKTOP.md](RUNNING-A-DESKTOP.md#engine-flags)).
