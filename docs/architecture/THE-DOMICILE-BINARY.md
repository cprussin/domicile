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
```

Three modules, and the split is by what each needs to be tested:

| Module | Pure? | What |
|---|---|---|
| `cli` | yes | the arguments, and every refusal a bad one earns |
| `components` | yes | the engine and the compositor, from the binary's own path or the environment |
| `shell_path` | yes | a name or a path to a module → the module to load, and the directory it is served out of |
| `platform` | yes | `OZONE` / `WAYLAND_DISPLAY` / `DISPLAY` → the ozone platform, or the refusal that names what to do instead |
| `supervise` | no | temp dirs, two children in order, the broker socket, teardown |

The first three are the ones with the subtle rules, and they become ordinary
unit tests against strings and a temp directory. `supervise` is the part that
genuinely spawns, and it stays thin enough to read.

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
  lands. See *The transport exists now* below.

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

The socket goes at `$XDG_RUNTIME_DIR/domicile.sock`, discovered rather than
passed, because a client that has to be told where the desktop is has to be
told by something that already knew.

**The supervisor answers it, and routes.** `load-shell` is carried out by
whatever serves the page, but the next commands are not: asking which windows
are open is the compositor's. A socket owned by whichever process happens to
answer the first command is a socket that moves when the second one lands.

```
domicile load-shell ─▶ domicile.sock ─▶ the supervisor ─▶ the engine ─▶ the page
```

### The transport exists now

**It was waiting on `domicile://`, and `domicile://` landed.** The page used to
be reached through the bridge, whose WebSocket was a byte pipe to the
compositor's control socket, so telling the page to load a different shell
meant either a second bridge-owned socket or making the bridge a *speaker* of a
protocol it only carried. That choice is gone with the bridge: the engine
serves the shell over `domicile://`, writes the document in C++, and the
control channel is an IDL binding on the unix socket the engine process already
holds.

So the hop is the engine's, there is no process in the middle with a deletion
date, and nothing blocks this but the work itself. The poller did not survive
the move — see the dev-reload note under *Key decisions* — so a dev desktop has
no reload until `load-shell` is what provides it.

## Plan

- [x] `shell_path` and `platform` in `domicile-launch` — the two with rules, as
      unit tests against a string and an injected filesystem
- [x] `cli`, `components`, `supervise`, and the `[[bin]]`. The argument parser
      lands with the program that reads it rather than ahead of it: on its own
      it is a parser nothing calls
- [x] `flake.nix`: the three components go where the binary looks, and
      `domicileCli` — the `writeShellApplication` — goes
- [x] delete `run-engine.sh` and the three `test-run-engine-*.sh`
- [ ] the control socket, and `domicile load-shell` — unblocked: the hop to
      the page is the engine's now, and it is what a dev reload would use
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
