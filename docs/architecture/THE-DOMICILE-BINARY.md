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
domicile <shell>       # a directory, or the shell.js in one
```

Three modules, and the split is by what each needs to be tested:

| Module | Pure? | What |
|---|---|---|
| `cli` | yes | the arguments, and every refusal a bad one earns |
| `components` | yes | the engine, the compositor and the bridge, from the binary's own path or the environment |
| `shell_path` | yes | a name or a path → the directory to serve, and the `shell.js` in it |
| `platform` | yes | `OZONE` / `WAYLAND_DISPLAY` / `DISPLAY` → the ozone platform, or the refusal that names what to do instead |
| `supervise` | no | temp dirs, three children in order, the bridge's URL, the broker socket, teardown |

The first three are the ones with the subtle rules, and they become ordinary
unit tests against strings and a temp directory. `supervise` is the part that
genuinely spawns, and it stays thin enough to read.

## Key decisions

- **`domicile` builds nothing.** `run-engine.sh` reads an unset
  `DOMICILE_COMPOSITOR` as "build it with cargo" and an unset `DOMICILE_PAGE`
  as "build a workspace shell with turbo". That is a developer's convenience
  sitting in the entry point every user runs, and it is why the script needs a
  checkout to make sense of itself. The binary requires its three components
  and names the missing one. Whatever built them ran first.

- **There is no watch mode.** A bundler in the supervisor is the same mistake
  one level up. Instead the desktop takes commands, the way `swaymsg` sends
  them to sway:

  ```sh
  domicile load-shell ./my-desktop/dist/shell.js
  ```

  which replaces the running shell with that one. A watch script then lives
  entirely outside the runtime — rebuild, then send the command — and it is a
  two-line loop rather than a mode.

  **This is strictly less machinery than what it replaces.** Dev reload today
  is a token endpoint on the bridge plus a poller written into every served
  document, asking twice a second, for the life of the desktop, whether the
  bundle changed. `DEV_RELOAD_PATH`, `buildToken` and `shellDocument`'s
  injected script all go: a command that arrives when something happened beats
  a page asking whether anything has.

  It also gives the hot swap its trigger. `announce_open_apps` already makes a
  chrome reload survivable — a page that reloads is told the desktop and every
  window already open — and until now nothing but that poller asked for one.

- **The three components ship beside the binary and are found there.** Not
  passed, and not wrapped in: `domicile` resolves them from its own location,
  the way a multi-binary program like postfix does.

  ```
  <prefix>/bin/domicile
  <prefix>/bin/domicile-compositor
  <prefix>/libexec/domicile/engine/     the Chromium tree, `chrome` inside it
  <prefix>/libexec/domicile/bridge      the page server
  ```

  `current_exe()` on Linux reads `/proc/self/exe`, which resolves symlinks —
  so a `~/.nix-profile/bin/domicile` pointing into the store finds its siblings
  in the same store output, which is exactly where they are. A distribution
  packaging this into `/usr` gets the same answer for the same reason.

  `DOMICILE_ENGINE`, `DOMICILE_COMPOSITOR` and `DOMICILE_BRIDGE` still override,
  one each, for a checkout pointing at things it just built. **That is the whole
  of the flake's remaining job**: place three files and let the binary find
  them. No `wrapProgram`, no exported paths, no `writeShellApplication`.

  `OUT` goes with it. `run-engine.sh` takes a Chromium *checkout* and appends
  `out/Domicile` or `.` depending on whether the engine was built or published;
  the variable names the directory holding `chrome` and there is nothing to
  append.

## The control socket

`domicile <shell>` runs a desktop; `domicile <command>` sends that desktop a
command. One binary, told apart by whether the first argument names a page or
a verb — sway does the same thing with two names, and one is enough here
because the desktop is the only thing either form talks about.

The socket goes at `$XDG_RUNTIME_DIR/domicile.sock`, discovered rather than
passed, because a client that has to be told where the desktop is has to be
told by something that already knew.

**The supervisor answers it, and routes.** `load-shell` is the bridge's to
carry out — it is what serves the page — but the next commands are not: asking
which windows are open is the compositor's, and the one after that may be the
engine's. A socket owned by whichever process happens to answer the first
command is a socket that moves when the second one lands.

Three hops for `load-shell`, and each already exists as a pipe:

```
domicile load-shell ─▶ domicile.sock ─▶ the supervisor ─▶ the bridge ─▶ the page
```

The last hop is the only new one. The bridge's WebSocket to the page is a byte
pipe to the compositor and must stay one, so the reload arrives on a second,
bridge-owned socket that the written document opens — the same place the
poller is torn out of, doing the same job by being told instead of asking.

## Plan

- [x] `shell_path` and `platform` in `domicile-launch` — the two with rules, as
      unit tests against a string and an injected filesystem
- [ ] `cli`, `components`, `supervise`, and the `[[bin]]`. The argument parser
      lands with the program that reads it rather than ahead of it: on its own
      it is a parser nothing calls
- [ ] `flake.nix`: the three components go where the binary looks, and
      `domicileCli` — the `writeShellApplication` — goes
- [ ] delete `run-engine.sh` and the three `test-run-engine-*.sh`
- [ ] the control socket, and `domicile load-shell`
- [ ] delete `DEV_RELOAD_PATH`, `buildToken` and the document's poller;
      `dev-shell.sh` becomes a rebuild that sends the command
- [ ] `spike-shell.sh` calls the binary rather than repeating the launch

## Open questions

- **What the bridge's reload hop is.** The page needs telling, and the session
  WebSocket is a byte pipe to the compositor that must stay one. Recommendation:
  a second WebSocket the bridge owns and the written document opens — it is
  where the poller already is, so nothing new appears in the page, and it keeps
  `domicile-protocol` out of a question that is not the compositor's. The
  alternative, a `HostMessage` the bridge injects, makes the bridge a speaker
  of a protocol it currently only carries.

- **Whether the bridge can ship as an executable.** It is run as `bun <entry>`
  today, and the flake's wrapper is what puts `bun` on `PATH`. Found by
  siblings, `libexec/domicile/bridge` should be a thing that runs rather than a
  script needing an interpreter that may not be installed — which is what
  `bun build --compile` produces. Recommendation: compile it, because the
  alternative is keeping a wrapper for one `PATH` entry after everything else
  it did has gone.

- **Whether `load-shell` restarts anything.** A new module is a page reload,
  which the desktop already survives. A shell that changed its *compositor*
  config is not, and this command does not pretend to be that. Recommendation:
  `load-shell` reloads the page and nothing else, and says so.

- **Whether `spike-shell.sh` can use the binary at all.** It needs a long
  `DOMICILE_REACH_MS` and its own log capture, and it runs on `crux` where the
  engine job is the only thing that exercises it. Recommendation: convert it
  last, behind the rest, so a mistake there cannot hold up the parts ordinary
  CI covers.
