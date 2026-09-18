# `domicile` is a program, not a shell script

`domicile ./my-desktop/dist/shell.js` starts a desktop. One binary, no wrapper
in the path, and nothing between the name a person types and the code that
runs.

## Problem

Starting a desktop is not shell-shaped work. It resolves a path against three
rules, decides an ozone platform from four environment variables, starts two
processes in a forced order, waits on a line of stdout and a socket, and cleans
up. Every one of those is easier to state, and far easier to test, in the
language the compositor is already written in.

It was ~500 lines of bash in three layers — a `writeShellApplication` in
`flake.nix`, `run-engine.sh`, and `dev-shell.sh` — and ~470 more lines of bash
testing them, each test `awk`ing a block out of a script and eval-ing it
because a copy is a thing that passes while the script it stands for does not.
That is a good technique and an expensive one, and the only thing that makes it
necessary is logic sitting where nothing can call it. **That is the rule this
doc is really about**: the scripts here arrange and observe, and decide
nothing. `dev-shell.sh` is the one that came closest to deciding again, and
what it does now is build, then call the binary.

## Design

**`domicile` is a `[[bin]]` on `domicile-launch`**, which already calls itself
"the boundary between a shell and the compositor it runs" and already owns both
things that cross it — the compositor's command line and the session document
it publishes. The supervisor is the third. It needs no GPU and no display, so
the crate stays in `default-members` and its tests stay cheap.

```
domicile <shell>                  # the built JavaScript module the shell is
domicile --config <path> <shell>  # ...with the compositor's own file
domicile <command>                # ...or a command for the desktop already running
```

`--config` may come on either side of the shell, and leaving it off is an
answer rather than a missing one: `$XDG_CONFIG_HOME/domicile/domicile.toml`
(`~/.config/...` where that is unset), and the compositor's defaults where
there is no such file — a single output that follows the engine's own window.
What is refused is the half-stated form — the flag with nothing behind it, or
twice — because the compositor runs its defaults on a missing file and refuses
one it cannot load, and guessing between those picks one answer for somebody
who meant the other. A verb takes nothing, `--config` included: the desktop it
questions read its config when it started.

**That default path is `domicile`'s, and deliberately not the compositor's.**
`arguments` below states the compositor's rule — every value given, nothing
read from the environment, nothing with a default location — and it is kept:
`domicile` works out which file this run has and writes it onto the command
line it builds. The compositor is still handed one path or none by a program
that can be asked why. What pays for the guess is that the run prints which of
the four answers it got, `--config` and found-by-looking included, before it
starts anything.

The modules, and the split is by what each needs to be tested:

| Module | Pure? | What |
|---|---|---|
| `cli` | yes | the arguments, and every refusal a bad one earns |
| `components` | yes | the engine and the compositor, from the binary's own path or the environment |
| `shell_path` | yes | a name or a path to a module → the module to load, and the directory it is served out of |
| `platform` | yes | `OZONE` / `WAYLAND_DISPLAY` / `DISPLAY` / `XDG_VTNR` → the ozone platform (a console login takes `drm` on its own), or the refusal that names what to do instead |
| `control` | yes | what a running desktop can be asked, and what it answers |
| `arguments` | yes | the compositor's command line, every value stated and nothing defaulted |
| `config_path` | yes | which config file a run has: `--config`, the one where a config lives, or none — and which of those it was |
| `spawn` | yes | the commands the engine and the compositor are, built as data so a flag list is an assertion |
| `session` | yes | what the compositor publishes once it is up, and the shell's wait for it |
| `milestones` | yes | what a run has to reach before it is a desktop, and the sentence it prints when it does not |
| `handshake` | yes | whether a page ever reached the compositor, and what to say when none did |
| `supervise` | no | temp dirs, two children in order, the broker socket, teardown |
| `control_socket` | no | where a desktop answers, taking it from whatever is there, and carrying a line each way |

The pure ones are where the subtle rules are, and they become ordinary unit
tests against strings and a temp directory. `supervise` is the part that
genuinely spawns and `control_socket` the part that genuinely binds; both stay
thin enough to read.

## Key decisions

- **`domicile` builds nothing.** It requires both its components and names the
  missing one; whatever built them ran first. The rejected alternative was a
  developer's convenience — an unset `DOMICILE_COMPOSITOR` meaning "build it
  with cargo", an unset page meaning "build a workspace shell with turbo" —
  which puts a build in the entry point every user runs and leaves it needing
  a checkout to make sense of itself.

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

  **It is strictly less machinery than the dev reload it replaces**, which was
  a token endpoint on the bridge plus a poller written into every served
  document, asking twice a second, for the life of the desktop, whether the
  bundle changed. All of it went with the bridge, and the C++ that writes the
  document has nothing in its place — **so a dev desktop has no reload at all
  until this lands**, and a rebuilt shell needs the desktop restarted. See
  *The engine's half, which is in* below.

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

  `DOMICILE_ENGINE` names the directory holding `chrome`, with nothing appended
  to it — not a Chromium checkout that the reader would have to know is
  completed with `out/Domicile` or with nothing depending on how the engine was
  obtained.

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

### The engine's half, which is in

The page is the engine's, so `load-shell` is an engine-side change, and there
were two shapes for it:

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

The wire is one line each way:

```
{"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
{"type":"loaded"}   |   {"type":"refused","why":"…"}
```

**The version is in the request, and the refusal is the check.** This socket
joins two *separately published* deploy units — `engine-release.nix` pins an
engine built from an older commit than `main` — so
[`DATA.md`](/docs/guidelines/DATA.md)'s versioning rule applies to it, unlike
the control socket above, whose two ends are one binary. Path versioning does
not fit a socket the supervisor names and the engine binds, and every
connection is exactly one request, so there is no handshake to negotiate it in
either.

| | |
|---|---|
| `components/domicile/browser/shell_source.{h,cc}` | which shell this process serves. Seeded from the two switches, replaceable after |
| `components/domicile/browser/command_protocol.{h,cc}` | the wire: a line in, a line out, the applying injected. Where the tests are |
| `chrome/browser/domicile/domicile_command_socket.{h,cc}` | the socket, and the shell's window. `//chrome` because reloading needs `GlobalBrowserCollection`, which a `//components/domicile` target may not depend on |

**What is left is the supervisor's half**: `--domicile-command-socket` on the
engine's command line in `spawn`, a `load-shell` verb in `cli` and `control`,
and `answer` dialing the engine rather than holding the answer itself. The
engine side is no longer the thing to wait for — the release `engine-release.nix`
pins is built past it, so the switch is there on the engine a desktop actually
runs, and nothing is asking for it.

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
- [x] the engine's command socket: `--domicile-command-socket`, the
      `load_shell` wire and its version, and the reload that carries it out.
      The half that is a patch to the fork, and the half nothing in this
      repository can build
- [ ] `domicile load-shell <path>` — the supervisor's half of it: the switch
      on the engine's command line, the verb, and the dial. It is what a dev
      reload would use
- [ ] `guard-shell.sh` calls the binary rather than repeating the launch

## Open questions

- **Whether `load-shell` restarts anything.** It switches the shell; the
  desktop underneath it does not move. `announce_open_apps` already tells a
  page that has just loaded the desktop and every window open on it, so
  switching from `simple` to `manganese` keeps the windows. A shell that
  changed the *compositor's* configuration is a different question and this
  command does not pretend to answer it.

- **What becomes of the spikes.** Settled, and the rule has held as the set
  grew. Anything `engine.yml` runs is a **guard**, named for what it gates —
  `under-wayland.sh` and ten `guard-*.sh` now, where there were four. A check
  that gates every engine change is not a spike. `spike-engine`,
  `spike-dmabuf` and `spike-iframe` keep their names and stay: they are run by
  hand rather than by CI, but ENGINE-FORK.md cites their results as evidence,
  so deleting them would orphan the citations and lose the ability to
  re-derive the numbers. `spike.sh` and its pages stay too —
  `guard-css-and-resize.sh` runs the spike driver twice, which is what it is.

- **Whether `guard-shell.sh` can use the binary at all.** It needs a long
  `DOMICILE_REACH_MS` and its own log capture, and it runs on `crux` where the
  engine job is the only thing that exercises it. Recommendation: convert it
  last, behind the rest, so a mistake there cannot hold up the parts ordinary
  CI covers.
