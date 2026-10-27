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
  `--config` names one. It prints which it used.
- A `.ts`, `.tsx` or a `.js` with bare imports is built first, with React and
  `@domicile-desktop/*` from Domicile's install. So are npm and `github:`
  packages ([SHELL-PACKAGING.md](SHELL-PACKAGING.md#distributing)).
- In a Wayland session it opens in a window; from a console login it takes
  the screen.

## `domicile which-shell`

Print the shell the running desktop serves.

## `domicile load-shell <shell>`

Serve another shell, or a new build of the same one. Windows stay open. It
takes the same forms as `domicile [shell]`. A failed build prints the error
and keeps the running shell.

## `domicile open <file|folder|url>`

Open a file or folder with its type's default app, or a link in a browser
window ([LAUNCHER.md](LAUNCHER.md#opening-files)).

- `domicile open --app <url|module>` opens a site or an app module as an
  app: its own window, without an address bar
  ([WEB-APPS.md](architecture/WEB-APPS.md)).
- `domicile open --which <file|url>` prints the app `open` would use.
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

## `domicile screen-record`

Open the shell's screen cast picker and record what is picked, with its sound,
until the toolbar's Stop. The video goes in `Videos/Screen recordings` and its
path is printed. Exits 1 if it is dismissed or discarded.

## `domicile send-shell <word>...`

Run a shell command, as a keybinding bound to it does:
`domicile send-shell workspace 2`. Manganese's commands are in
[KEYS.md](/packages/manganese-window-management/docs/KEYS.md#commands). It fails
when no page listens for commands.

## `domicile theme [light|dark|toggle]`

Set the theme until the desktop restarts, or print it. Set `theme.mode` in
the config to keep one.

## `domicile disable-while-typing [on|off|toggle]`

Set whether a touchpad ignores the pointer while you type, or print it. On by
default, and on again when the desktop restarts. A desktop in a window
refuses it: the host reads the touchpad.

## `domicile monitor <name> <W>x<H>[@Hz]`

Add a monitor with no screen, like a pane of another program the desktop is
shown in, and print its output (`virtual-1`). Each line read from stdin,
like `1024x768` or `1024x768@30`, resizes it in place: its windows stay. It
is removed when stdin ends. Exits 1 if the desktop takes it away first. Only a
desktop on a tty or headless has monitors to add to
([A-HEADLESS-DESKTOP.md](architecture/A-HEADLESS-DESKTOP.md)). 60 Hz unless
given.

## `domicile power-off`

Ask in Domicile's dialog, then turn the computer off.

## `domicile reboot`

Ask, then restart the computer.

## `domicile log-out`

Ask, then end the login session.

## `domicile check-config <file>`

Check a config file without a desktop. Exits non-zero with the reason the
compositor would refuse it. home-manager runs it on the file it writes.

## `domicile help`

Print the commands. `--help` and `-h` do the same, also after a verb.

## While locked

`screenshot`, `screen-record` and `send-shell` are refused while the desktop
is locked, as is adding a `monitor`. `theme` works, and a `monitor` added
before keeps resizing.

## Environment

`DOMICILE_ENGINE_ARGS` adds switches to the browser engine
([RUNNING-A-DESKTOP.md](RUNNING-A-DESKTOP.md#engine-flags)).
