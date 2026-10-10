# The `domicile` binary

`domicile ./my-desktop/dist/shell.js` starts a desktop. It is one Rust binary.

## Problem

Starting a desktop means:

- resolving a shell path
- picking an ozone platform from environment variables
- starting the engine and the compositor in order
- waiting on stdout and a socket
- cleaning up

This logic is easier to write and test in Rust than in bash. Scripts may
build and start things. All launch logic lives in the binary.
`scripts/dev-shell.sh` builds, then calls the binary.

## Design

`domicile` is a `[[bin]]` on `domicile-launch`. That crate already owns the
compositor's command line and the session document. The supervisor needs no
GPU or display, so the crate stays in `default-members` and its tests are
cheap.

```
domicile <shell>                  # run a desktop with this shell
domicile --config <path> <shell>  # ...with this compositor config
domicile which-shell              # ask the running desktop which shell it serves
domicile load-shell <shell>       # replace the running desktop's shell
domicile open-url <url>           # open a URL in the running desktop (BROWSER)
domicile screenshot               # the shell's interactive screenshot (Print in manganese)
domicile screenshot <file>        # write a PNG of the running desk
domicile send-shell <word>…       # run a shell command, as a SendShell keybinding does
domicile check-config <file>      # exit 1 with the reason if the compositor refuses this JSON config
```

Config file:

- `--config` may come before or after the shell.
- Without it, `domicile` looks for
  `$XDG_CONFIG_HOME/domicile/domicile.{ts,tsx,js,mjs,json}`
  (`~/.config/...` when unset). No file means compositor defaults: one output
  that follows the engine's window.
- A missing file means defaults. A file that fails to load is an error, and
  the compositor does not start.
- `--config` with no value, or given twice, is refused. Guessing wrong would
  silently run defaults or fail.
- Verbs never take `--config`. The running desktop read its config at startup.
- `domicile` resolves the default path. The compositor reads nothing from the
  environment (see `arguments`).
- `domicile` passes the chosen path on the compositor command line and prints
  which case applied before starting.

### Modules

Logic lives in pure modules so it can be unit-tested against strings and a
temp directory. The modules that spawn processes or bind sockets stay thin.

| Module | Pure? | What |
|---|---|---|
| `cli` | yes | arguments, and the error for each bad one |
| `components` | yes | finds the engine and compositor from the binary's path or the environment; the builder, bundled shells and apps when needed |
| `apps` | no | lists Domicile's own apps, which the compositor installs with the config's extensions, and lists the Settings app's native messaging host in the profile; see [HISTORY.md](/docs/HISTORY.md) and [SETTINGS.md](/docs/SETTINGS.md) |
| `settings` | yes | `domicile-settings-host`: the Settings app's native messaging, reading and writing the files the desktop names |
| `site_permissions` | yes | a site's permission and setting, as the engine, the control socket and the Settings host carry it |
| `shell_path` | yes | name or path → module to load and the directory it is served from |
| `shell_source` | yes | classifies a shell argument: module, entry to build, bundled shell, or package |
| `build_progress` | yes | parses builder output into a terminal progress bar |
| `splash` | yes | the splash shown during a slow first build: its copy, its progress file, and loading the shell once the engine answers |
| `platform` | yes | `OZONE` / `WAYLAND_DISPLAY` / `DISPLAY` / `XDG_VTNR` → ozone platform (a console login gets `drm`), or an error saying what to set |
| `control` | yes | control socket requests and replies; takes the engine calls as parameters for the commands it routes |
| `command` | yes | engine command wire: the line, its version, and the reply |
| `arguments` | yes | the compositor's command line; every value explicit, no defaults |
| `config_path` | yes | which config file a run uses: `--config`, the default location, or none, and which case it was |
| `config_watch` | no | watches the config's directory and reports edits |
| `xdg_open` | yes | `xdg-open` inside a desktop: http(s) goes to `open-url`, anything else to the next `xdg-open` on `PATH` |
| `address` | yes | what `open-url` sends the engine: a URL as given, or a path as a `file://` URL relative to the caller's directory |
| `spawn` | yes | the engine and compositor commands as data, so flag lists are testable |
| `session` | yes | what the compositor publishes once up, and waiting for it |
| `milestones` | yes | what a run must reach to be a desktop, and the message when it doesn't |
| `handshake` | yes | whether a page reached the compositor, and the message when none did |
| `heard` | yes | keeps each component's last output so the run can repeat it on failure |
| `restart` | yes | whether a dead component restarts, which one, the delay, and when to give up |
| `supervise` | no | temp dirs, starting both children in order, the broker socket, teardown |
| `profile_claim` | no | which engine profile this desktop uses: `profile`, or `profile-2`, `profile-3`… when taken |
| `profile_path` | yes | where the engine profile lives (`$XDG_STATE_HOME/domicile/profile`) |
| `control_socket` | no | binds the control socket, replacing a stale one, and carries one line each way |
| `command_socket` | no | dials the engine's command socket, one line each way |
| `graphical_session` | no | tells the systemd user manager the desktop is the graphical session |
| `notification` | no | sends desktop notifications for errors after startup, such as a broken config edit |

### Home Manager module

`nix/home-manager.nix` writes the config file that `config_path` reads. It
has one option per field of the `domicile-config` schema and generates JSON
with `pkgs.formats.json`.

Every config struct is `deny_unknown_fields`, so one unknown key rejects the
whole file (see Config file) and the desk does not start. So:

- The module runs `domicile check-config` on the file it writes. A refused
  config fails the build.
- `removedSettings` lists settings the schema dropped, by dotted path
  (`output.profiles[].displays[].mode`). Setting one fails an assertion that
  says where it went; `nix/removed-settings.nix` builds them.

Checks:

- `scripts/test-the-home-manager-module-agrees.sh` compares option names to
  the Rust structs, without Nix.
- `scripts/test-a-dropped-config-field-is-removed-here.sh` fails when a
  config field at any depth is gone since the base commit and
  `removedSettings` lists neither it nor an ancestor.
- `nix flake check` evaluates the module, reads back the file it writes,
  checks that a refused config fails to build, and tests
  `nix/removed-settings.nix` at the top, in a section and in a list.

## Key decisions

### `domicile` builds shells, nothing else

- The engine and compositor are required. A missing one is named. `domicile`
  never runs cargo or turbo and needs no checkout.
- A shell entry (`./desk.tsx`, a `.js` that imports a package) or a package
  (`my-shell`, `github:me/shell`) goes to `libexec/domicile/builder`. The
  builder reports steps as JSON lines, which `domicile` draws as a progress
  bar.
- A built bundle, or a bundled shell (`@domicile-desktop/manganese`, prebuilt
  under `libexec/domicile/shells`), needs no build.
- See [COMPOSABLE-SHELLS.md](/docs/architecture/COMPOSABLE-SHELLS.md).

### No watch mode

The supervisor contains no bundler. Instead the running desktop takes
commands, like `swaymsg` with sway:

```sh
domicile load-shell ./my-desktop/dist/shell.js
```

- It replaces the running shell with any shell, so it also switches from
  `simple` to `manganese` without restarting.
- Windows survive: the compositor never sees the change, and the browser owns
  browser windows' pages.
- `load-shell` changes only the shell. It does not apply compositor config.
  On load, `announce_open_apps` sends the new page the desktop and its open
  windows, and the browser sends its browser windows.
- The desktop needs no dev mode.

`scripts/dev-shell.sh` is the watch script built on it:

- The script starts the supervisor itself, so it reads the socket path from
  the supervisor's `DOMICILE_SOCK=<path>` output line. It calls `load-shell`
  only after the supervisor reports the desktop is up. Earlier calls are
  refused because the socket exists before the engine does.
- `scripts/dev-shell-reload.sh` waits for the bundle to stop changing (a quiet
  period plus a cap, as in `coalesce.rs`). `vite build --watch` writes one
  build in several steps, and reloading mid-write would load a broken shell.
- If the engine refuses a shell, the script prints the engine's `why` and
  waits for the next build. The desktop keeps the previous shell.

### Engine crashes are recovered; compositor crashes restart the desktop

| Exits | Restarted | Survives |
|---|---|---|
| engine | the engine | every window, with its last frame |
| compositor | the whole desktop | nothing |

```
the engine exited (signal: 9 (SIGKILL))
starting the engine again in 1s — that is failure 1 of 5 in a row.
```

Engine restart:

- An engine that fails restarts. One that exits 0 restarts only on `drm`
  (`restart::restarts_the_engine`): there is no window to close there, and
  Chromium exits 0 on `SIGTERM`, so `pkill` reads as a clean exit. A nested
  engine exits 0 when its window closes, which ends the run with
  `the engine exited (exit status: 0)`.
- The launcher removes the dead engine's broker socket. The new engine creates
  one at the same path.
- `EngineSession::reconnect` joins it and re-sends the desktop state: a frame
  sink per window, every client buffer, and each window's last frame.
- Clients keep their `wl_display` connection, so their windows and state
  survive.
- On a tty the screen is blank between engines, because the engine holds DRM
  master. The new engine modesets from the same `DisplaySnapshot`s, and the
  compositor re-sends its connectors once the engine joins.

Compositor restart:

- A compositor that exits 0 ends the run, with
  `the compositor exited (exit status: 0)`. Any other exit restarts the
  desktop.
- The page's control channel closes when either end exits
  (`components/domicile/browser/control_channel.h`). It only retries at
  startup, so a page cannot reconnect to a new compositor. Fixing that needs
  a C++ change in the fork.
- So the engine is stopped too, and a new desktop starts after everything the
  old one bound or published is removed. Apps exit.

Backoff:

- 1s, 2s, 4s, 8s; give up after five failures in a row.
- Each component has its own failure counter. After five engine failures in
  a row, the launcher counts one desktop failure and starts a new desktop.
- A component that ran for a minute resets its counter.

Detecting a new engine:

- The C ABI (`domicile_engine.h`) has four callbacks and no disconnect.
- The browser process dials the control channel, so `SO_PEERCRED` gives the
  browser's pid. A `hello` from a new pid means a new engine
  (`packages/domicile-compositor/src/which_engine.rs`).
- `load-shell` binds a new channel from the same browser, so the pid matches
  and no reconnect happens.

### Components are found beside the binary

```
<prefix>/bin/domicile
<prefix>/bin/domicile-compositor
<prefix>/libexec/domicile/engine/     the Chromium tree, with `chrome` inside
<prefix>/libexec/domicile/builder     builds a shell from an entry or a package
<prefix>/libexec/domicile/shells/     bundled shells and the splash, prebuilt
```

- `current_exe()` reads `/proc/self/exe`, which resolves symlinks. A
  `~/.nix-profile/bin/domicile` symlink finds its siblings in the same store
  output. A `/usr` install works the same way.
- `DOMICILE_ENGINE` and `DOMICILE_COMPOSITOR` override the lookup, for a
  checkout using its own builds. `DOMICILE_ENGINE` is the directory that
  contains `chrome`.
- The flake installs files at these paths. The binary needs no wrapper
  script or environment variables.

## The control socket

`domicile <shell>` runs a desktop. `domicile <verb>` sends a command to the
running one. The first argument decides which.

- Path: `$XDG_RUNTIME_DIR/domicile-ipc.<pid>.sock`, named after the
  supervisor's pid.
- The path is exported as `DOMICILE_SOCK` on the compositor, so every app the
  desktop spawns inherits it, and on the engine, so the Settings app's host
  does ([SETTINGS.md](/docs/SETTINGS.md)).
- One JSON line in, one back, then the connection closes.
  `domicile_launch::control` is the wire; `domicile_launch::control_socket` is
  the socket.
- The supervisor answers each connection on its own thread, since an
  interactive screenshot waits on the user.
- The supervisor answers and routes. `load-shell` and `open-url` go to the
  engine. `screenshot` and `send-shell` go to the compositor's chrome socket
  as the `screenshot` and `send_shell` system calls a page makes
  (`domicile_launch::compositor_socket`). The connection never says `hello`,
  so it is not a chrome. See
  [KEYBINDINGS.md](KEYBINDINGS.md#commands-from-a-terminal) for where a
  shell command goes from there.
- A whole-desk screenshot times out. An interactive one waits until the shell
  answers or the compositor hangs up. A shell that answers no portal requests
  leaves it waiting until the desktop exits. Ending `domicile screenshot`
  (Ctrl-C) does not withdraw the request or close the shell's dialog.

```
domicile which-shell ─▶ $DOMICILE_SOCK ─▶ supervisor
domicile load-shell  ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ engine ─▶ page
domicile open-url    ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ engine
domicile screenshot  ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ compositor
domicile send-shell  ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ compositor ─▶ every page
domicile-settings-host ─▶ $DOMICILE_SOCK ─▶ supervisor ─▶ engine   (site permissions; settings_files stops at the supervisor)
```

Several desktops per session:

- Each has its own socket and tells its own apps, so a command reaches the
  desktop it was typed in.
- Each has its own engine profile. Chromium allows one browser per profile and
  forwards a second launch to the first. The first takes `profile`, the next
  `profile-2`, like `wayland-2`.
- A client without `DOMICILE_SOCK` is refused with a message saying what to
  set. It does not scan the runtime directory, because with several desktops
  it would have to guess.
- A socket whose desktop died refuses on connect and says so. A non-socket
  file at the path is left alone.

### Opening links

- `BROWSER` is `domicile-open-url`, set on the compositor next to
  `DOMICILE_SOCK`. It is a separate `[[bin]]` that execs `domicile open-url`,
  because most programs run `BROWSER` as a single word.
- The compositor's `PATH` starts with a run directory where `xdg-open` links
  to `domicile-xdg-open`. Links open in this desktop regardless of
  `mimeapps.list`; other targets go to the next `xdg-open` on `PATH`.
- Apps whose wrappers put another `xdg-open` first (nixpkgs wrappers often
  prefix `xdg-utils`) read `mimeapps.list` instead. The package ships
  `share/applications/domicile-mimeapps.list`, and the compositor's
  `XDG_DATA_DIRS` starts with that `share`. It applies only when
  `XDG_CURRENT_DESKTOP` is `domicile`, and nothing is written to the home
  directory.
- The engine opens a browser window at the URL. The shell sees it in its
  window list, so a shell mid-reload gets it with every other window.

### The engine command socket

`load-shell` needs the engine to change which shell it serves. The supervisor
dials a command socket on the engine, passed as `--domicile-command-socket`.

Why a separate socket instead of a new `HostMessage` forwarded by the compositor:

- Which shell to serve is supervisor-to-engine information. The supervisor
  already passes `--domicile-shell-root` and `--domicile-shell-module` at
  launch.
- A `HostMessage` would add a message to the host↔chrome contract that the
  page never uses, and route it through the compositor.
- The compositor stays out of the path, so windows are unaffected.

Wire, one line each way:

```
{"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
{"type":"loaded"}   |   {"type":"refused","why":"…"}
```

- The request carries a version, and the engine refuses one it does not
  support. The engine and the supervisor ship separately (`engine-release.nix`
  pins an older engine build), so [DATA.md](/docs/guidelines/DATA.md)'s
  versioning rule applies. The control socket needs no version: both ends are
  the same binary.
- Each connection is one request, so there is no handshake to negotiate a
  version in.

Engine side:

| File | What |
|---|---|
| `components/domicile/browser/shell_source.{h,cc}` | which shell this process serves; seeded from the two switches, replaceable later |
| `components/domicile/browser/command_protocol.{h,cc}` | the wire: line in, line out, with the action injected; has the tests |
| `chrome/browser/domicile/domicile_command_socket.{h,cc}` | the socket and the shell's window; in `//chrome` because reloading needs `GlobalBrowserCollection`, which `//components/domicile` may not depend on |

Supervisor side:

- `spawn` adds `--domicile-command-socket`, under the run's directory.
- `cli` and `control` add the `load-shell` verb. `cli` validates each verb's
  arguments.
- `control::answer` takes the engine calls (`load`, `open`) as parameters, so
  routing stays string-in, string-out under test.
- The client resolves the path with `shell_path`, using its own working
  directory and `HOME`. Both sockets carry an absolute root and module. A path
  that names nothing is refused in the client's terminal.
- The supervisor records the served shell only after the engine replies
  `loaded`, so `which-shell` reports the loaded shell, and a refused load
  leaves it unchanged.

## Plan

Done:

- [x] `shell_path`, `platform`, `cli`, `components`, `supervise` and the
      `[[bin]]`
- [x] `flake.nix` places the components beside the binary
- [x] control socket and `domicile which-shell`
- [x] engine command socket (fork patch) and `domicile load-shell`

Left:

- [ ] `packages/domicile-engine/scripts/guard-shell.sh` launches through
      `domicile`. Convert it last: it has its own log capture and runs only on
      `crux` in the engine job, so a mistake there cannot block ordinary CI.
