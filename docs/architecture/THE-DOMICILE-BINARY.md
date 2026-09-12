# `domicile` is a program, not a shell script

`domicile ./my-desktop/dist/shell.js` starts a desktop. One binary, no wrapper
in the path, and nothing between the name a person types and the code that
runs.

## Problem

Starting a desktop today goes through three layers of bash:

| Layer | Lines | What it does |
|---|---|---|
| `flake.nix`'s `domicileCli` | 30 | refuses no-args, sets four store paths, `exec`s the next layer |
| `scripts/run-engine.sh` | 365 | the whole orchestration |
| `scripts/dev-shell.sh` | 106 | the same, plus a watch build |

And ~470 more lines of bash test that bash: `test-run-engine-inputs.sh`,
`test-run-engine-shell.sh`, `test-run-engine-platform.sh`, `test-dev-shell.sh`.
Each extracts a block out of the script with `awk` and evals it, because a copy
is a thing that passes while the script it stands for does not — which is a
good technique and an expensive one, and it exists because the logic is in bash
rather than somewhere it could be called.

The orchestration is not shell-shaped work. It resolves a path against three
rules, decides an ozone platform from three environment variables, starts three
processes in a forced order, waits on a line of stdout and a socket, and cleans
up. Every one of those is easier to state, and far easier to test, in the
language the compositor is already written in.

## Design

**`domicile` is a `[[bin]]` on `domicile-launch`**, which already calls itself
"the boundary between a shell and the compositor it runs" and already owns both
things that cross it — the compositor's command line and the session document
it publishes. The supervisor is the third. It needs no GPU and no display, so
the crate stays in `default-members` and its tests stay cheap.

```
domicile <shell>       # the built JavaScript module the shell is
domicile <command>     # ...or a command for the desktop already running
```

The modules, and the split is by what each needs to be tested:

| Module | Pure? | What |
|---|---|---|
| `cli` | yes | the arguments, and every refusal a bad one earns |
| `components` | yes | the engine and the compositor, from the binary's own path or the environment |
| `shell_path` | yes | a name or a path to a module → the module to load, and the directory it is served out of |
| `platform` | yes | `OZONE` / `WAYLAND_DISPLAY` / `DISPLAY` → the ozone platform, or the refusal that names what to do instead |
| `control` | yes | what a running desktop can be asked, and what it answers |
| `supervise` | no | temp dirs, two children in order, the broker socket, teardown |
| `control_socket` | no | where a desktop answers, taking it from whatever is there, and carrying a line each way |

The pure ones are where the subtle rules are, and they become ordinary unit
tests against strings and a temp directory. `supervise` is the part that
genuinely spawns and `control_socket` the part that genuinely binds; both stay
thin enough to read.

## Key decisions

- **`domicile` builds nothing.** `run-engine.sh` reads an unset
  `DOMICILE_COMPOSITOR` as "build it with cargo" and an unset `DOMICILE_PAGE`
  as "build a workspace shell with turbo". That is a developer's convenience
  sitting in the entry point every user runs, and it is why the script needs a
  checkout to make sense of itself. The binary requires both its components
  and names the missing one. Whatever built them ran first.

- **There is no watch mode.** A bundler in the supervisor is the same mistake
  one level up. Instead the desktop takes commands, the way `swaymsg` sends
  them to sway:

  ```sh
  domicile load-shell ./my-desktop/dist/shell.js
  ```

  which replaces the running shell with that one — **any** shell, not a fresh
  copy of the one already running. A watch script is then one use of it and
  lives entirely outside the runtime, but so is switching from `simple` to
  `manganese` without stopping the desktop, and the windows survive either way
  because the compositor never hears about it.

  **It is strictly less machinery than what it replaces.** Dev reload was a
  token endpoint on the bridge plus a poller written into every served
  document, asking twice a second, for the life of the desktop, whether the
  bundle changed. `DEV_RELOAD_PATH`, `buildToken` and `shellDocument`'s
  injected script went with the bridge; the C++ that writes the document now
  has nothing in their place, so there is no reload in a dev desktop until this
  lands. See *What `load-shell` still needs* below.

- **The two components ship beside the binary and are found there.** Not
  passed, and not wrapped in: `domicile` resolves them from its own location,
  the way a multi-binary program like postfix does.

  ```
  <prefix>/bin/domicile
  <prefix>/bin/domicile-compositor
  <prefix>/libexec/domicile/engine/     the Chromium tree, `chrome` inside it
  ```

  `current_exe()` on Linux reads `/proc/self/exe`, which resolves symlinks —
  so a `~/.nix-profile/bin/domicile` pointing into the store finds its siblings
  in the same store output, which is exactly where they are. A distribution
  packaging this into `/usr` gets the same answer for the same reason.

  `DOMICILE_ENGINE` and `DOMICILE_COMPOSITOR` still override, one each, for a
  checkout pointing at things it just built. **That is the whole of the flake's
  remaining job**: place two files and let the binary find them. No
  `wrapProgram`, no exported paths, no `writeShellApplication`.

  `OUT` goes with it. `run-engine.sh` takes a Chromium *checkout* and appends
  `out/Domicile` or `.` depending on whether the engine was built or published;
  the variable names the directory holding `chrome` and there is nothing to
  append.

## The control socket

`domicile <shell>` runs a desktop; `domicile <command>` sends that desktop a
command. One binary, told apart by whether the first argument names a page or
a verb — sway does the same thing with two names, and one is enough here
because the desktop is the only thing either form talks about.

The socket goes at `$XDG_RUNTIME_DIR/domicile-ipc.<pid>.sock`, named after the
supervisor that owns it, and its path is exported as `DOMICILE_SOCK` onto the
compositor — so every app the desktop spawns inherits the way back to the
desktop it is running in. That is sway's arrangement (`SWAYSOCK`), and
Hyprland's (`HYPRLAND_INSTANCE_SIGNATURE`), for the reason `WAYLAND_DISPLAY`
itself is per-instance: a compositor is a thing you can run more than one of.
One line of JSON in, one back, and the connection is over —
`domicile_launch::control` is the wire and `domicile_launch::control_socket` is
the socket.

**The supervisor answers it, and routes.** `load-shell` is carried out by
whatever serves the page, but the next commands are not: asking which windows
are open is the compositor's. A socket owned by whichever process happens to
answer the first command is a socket that moves when the second one lands.

```
domicile which-shell ─▶ $DOMICILE_SOCK ─▶ the supervisor
domicile load-shell  ─▶ $DOMICILE_SOCK ─▶ the supervisor ─▶ the engine ─▶ the page
```

**A session holds as many desktops as it likes.** Each answers its own socket
and each tells its own apps where that is, so a command reaches the desktop it
was typed inside rather than whichever one started first.

A client with no `DOMICILE_SOCK` is refused, by name, and told what to set. It
would be reachable to scan the runtime directory instead and it is deliberately
not done: with several desktops per session a scan has to guess which one was
meant, and a command that silently picks a desktop is worse than one that
declines. A socket whose desktop was killed refuses on connect and says so;
anything at that path that is not a socket is somebody else's file and is left
alone.

### What `load-shell` still needs, and it is in the engine

The page is the engine's, and **the engine cannot presently be told anything
about which shell it serves**:

- `ShellURLLoaderFactory` takes `--domicile-shell-root` at construction and
  `ServeDocument` reads `--domicile-shell-module` off
  `base::CommandLine::ForCurrentProcess()` per request. Both are the command
  line the browser process was started with, and a process's command line
  cannot be changed from outside it.
- `ControlChannel` is the only thing the browser process reads from, and it is
  a *client* of the compositor's `--chrome-socket`. Nothing on it reloads or
  navigates the shell's own window; `WebViewGuest::Reload` reloads a guest.

So `load-shell` is one engine-side change, and there were two shapes for it:

| | Route | What it does to the layering |
|---|---|---|
| **A** | the engine takes a `--domicile-command-socket` of its own and the supervisor dials it | a listener in the browser process, on a supervisor-to-engine link that already exists in another form; the arrow above is literal |
| **B** | a new `HostMessage` the compositor sends down the channel the engine already reads | `PROTOCOL_VERSION`'s contract grows a message that is not the chrome's, and the compositor is put in a hop it has no business in |

**A, on the layering.** Which shell to serve is supervisor-to-engine
information: the supervisor already says it once at launch, as
`--domicile-shell-root` and `--domicile-shell-module`, and a command socket is
that relationship still running. B widens the host↔chrome contract with a
message the page neither sends nor reads, and makes the compositor carry mail
it has no stake in. A also keeps the windows by construction rather than by
care — the compositor is not in the path, so it never hears the shell change.

A's socket joins two *separately published* deploy units: `engine-release.nix`
pins an engine built from an older commit than `main`. So
[`DATA.md`](/docs/guidelines/DATA.md)'s versioning rule applies to it, unlike
the control socket in `domicile-launch`, whose two ends are one binary.

Either way the poller did not survive the bridge — see the dev-reload note
under *Key decisions* — so a dev desktop has no reload until this lands.

## Plan

- [x] `shell_path` and `platform` in `domicile-launch` — the two with rules, as
      unit tests against a string and an injected filesystem
- [x] `cli`, `components`, `supervise`, and the `[[bin]]`. The argument parser
      lands with the program that reads it rather than ahead of it: on its own
      it is a parser nothing calls
- [x] `flake.nix`: the three components go where the binary looks, and
      `domicileCli` — the `writeShellApplication` — goes
- [x] delete `run-engine.sh` and the three `test-run-engine-*.sh`
- [x] the control socket: taken by the supervisor, answered on a thread of its
      own, and `domicile which-shell` over it — the command whose whole answer
      the supervisor holds, so the transport ships before anything has to route
- [ ] `domicile load-shell <path>` — blocked on the engine being tellable at
      all; see *What `load-shell` still needs*. It is what a dev reload would
      use
- [ ] `guard-shell.sh` calls the binary rather than repeating the launch

## Open questions

- **~~Whether the bridge survives long enough to be worth compiling.~~**
  Answered by events: it did not. The question was whether to spend
  `bun build --compile` on `libexec/domicile/bridge` so a packaged desktop
  would not need `bun` on its `PATH` at run time. `domicile://` landed first,
  the bridge was deleted rather than compiled, and a packaged desktop needs no
  JavaScript runtime at all.

- **Whether `load-shell` restarts anything.** It switches the shell; the
  desktop underneath it does not move. `announce_open_apps` already tells a
  page that has just loaded the desktop and every window open on it, so
  switching from `simple` to `manganese` keeps the windows. A shell that
  changed the *compositor's* configuration is a different question and this
  command does not pretend to answer it.

- **What becomes of the spikes.** ~~Settled.~~ Five of the eight are the only
  end-to-end checks this project has and `engine.yml` runs them, so they are
  named for what they do: `under-wayland.sh` and the four guards
  (`guard-client-window`, `guard-two-windows`, `guard-shell` four times over,
  `guard-css-and-resize`). A check that gates every engine change is not a
  spike. The other three — `spike-engine`, `spike-dmabuf`, `spike-iframe` —
  keep their names and stay: they are run by hand rather than by CI, but
  ENGINE-FORK.md cites their results as evidence, so deleting them would orphan
  the citations and lose the ability to re-derive the numbers. `spike.sh` and
  its pages stay too — `guard-css-and-resize.sh` runs the spike driver twice,
  which is what it is.

- **Whether `guard-shell.sh` can use the binary at all.** It needs a long
  `DOMICILE_REACH_MS` and its own log capture, and it runs on `crux` where the
  engine job is the only thing that exercises it. Recommendation: convert it
  last, behind the rest, so a mistake there cannot hold up the parts ordinary
  CI covers.
