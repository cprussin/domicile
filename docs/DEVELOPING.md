# Developing Domicile

How to run, test and debug this repository out of a checkout. The rules for
the code itself are in [/docs/guidelines/](/docs/guidelines/); this is the
workflow around them.

## Run and test

```sh
nix develop                  # core shell: rust + node
cargo test                   # the pure-logic core
bun run turbo test           # TypeScript: lint, types, unit tests

nix develop .#full           # adds wayland, mesa, weston, kitty
./scripts/check.sh           # EVERYTHING: every test-*.sh, every e2e-*.sh,
                             # cargo, turbo. The whole answer before a push.
./scripts/check.sh e2e       # or one group: shell, rust, typescript, e2e
```

`check.sh` picks up any `scripts/test-*.sh` and `scripts/e2e-*.sh` by glob, so a
new check runs by existing. `smoke-compositor.sh` is outside that loop and is
run by hand. Everything here wants a checkout: the flake offers no app over any
of it, because `nix run` with no clone meant staging the store's read-only
source into a cache and building there, and nothing ever ran that.

Nothing in the suite needs a display.

```sh
# A desktop, on a machine that has a screen.
nix run 'github:cprussin/domicile#manganese'    # the reference shell
nix run 'github:cprussin/domicile' -- ./dist/shell.js   # a shell of your own
./scripts/dev-shell.sh manganese               # …and rebuilt as you edit
```

The engine job on `crux` is the only thing that builds the fork and drives the
pixel guards. It shares a checkout with whoever else is working there, so it
takes a lock first: `.github/scripts/engine-tree-lock.sh`, which is also what a
person on that machine runs before building by hand.

## Reading the compositor's frame report

One `INFO` line per window of frames:

```
composited fps commit_ms composite_ms composite_worst_ms
submit_ms submit_worst_ms idle_ms response_ms response_worst_ms chromes
```

- `composite_ms` — importing the client's buffer and drawing every layer, **up
  to but not including** the submit.
- `submit_ms` — the submit alone, which on a nested window blocks for a frame
  callback. Kept apart from `composite_ms` because a figure that includes the
  buffer swap is not comparable with one that does not.
- `response_ms` — the client's own redraw, which is the client's number rather
  than ours, and the control on the other two.
- `idle_ms` — how much of the window nothing happened in.

## Reading a slow launch

Every app the shell starts leaves three lines, in this order:

```
spawning client pid=1234 command=["kitty"] wayland_display="wayland-2"
app client connected pid=Some(1234)
toplevel mapped -> Host::app_appeared app_id=app-1
```

- **spawn → connected** is the app's own startup, before it has said a word to
  the compositor: linking, its caches, fontconfig, its GL driver. None of it is
  ours.
- **connected → mapped** is the Wayland conversation, so a compositor slow to
  answer shows up here and nowhere else.

Match on the pid rather than on order. Somebody who presses the launcher key
again because nothing happened has several spawns in flight and their arrivals
come back in whatever order the apps get there.

A first launch of seconds where every later one is a tenth of that is a cold
machine — page cache after a `nix build`, fontconfig, the Mesa shader cache —
and the split says so by putting the time in spawn → connected. A GPU client
is separately slow *after* mapping; see the kitty note below.

## Gotchas that will bite you

- **`nix develop` only sees git-tracked files.** A brand-new untracked file makes
  the flake error with "not tracked by Git" — `git add` it first. Staging is
  enough; a dirty tree only warns.
- **`nix run github:…?ref=<branch>` caches a branch for an hour.** A run right
  after a push re-runs the *old* revision, which reads exactly like "my fix did
  nothing". Pass `--refresh` whenever the branch is moving.
- **Unix socket paths are capped at ~108 characters.** Use a short
  `XDG_RUNTIME_DIR` like `/tmp/domicile-rt` for anything that binds one.
- **Which way up an output is drawn cannot be tested without a screen.** Reading
  a buffer back is consistent either way, so the offscreen tests pass under
  both. It was settled on hardware; do not "simplify" it.
- **A solid-color texture cannot test a texture matrix** — it looks the same
  however it is mapped. Fixtures are patterned for this reason: a y-inversion
  bug passed a solid-texture comparison unchanged.
- **A client's buffer may be upside down and the types do not say so.** A client
  that renders with GL sets `Y_INVERT`; Smithay records it and does not expose
  it, so it is carried from the import.
- **A global a client wants and does not find is not an error it reports.** A
  missing `wl_data_device_manager` showed up as the chrome freezing whenever a
  tab was dragged.
- **gpg signing fails in the agent container.** Commit with
  `git -c commit.gpgsign=false …`.

Smithay, specifically:

- **Keycodes need `+8`** (evdev → xkb) from the chrome, which sends evdev.
- **Flush clients** after dispatch *and* after off-thread input, or clients hang.
- **A `wl_output` global is required** or many clients never map a toplevel, and
  **`wl_surface.enter` must be sent** — a toolkit that scales its content asks
  which output it is on before drawing anything. GLFW, and so kitty, blocks on
  exactly that and maps a window that stays blank.
- **A v3 dmabuf global is not enough for Mesa**: the format list says what a
  client may allocate, never which GPU. That comes from v4 feedback's
  `main_device`.
- **Buffers must be released.** Smithay releases the *previous* buffer on the
  next commit — the one the client cannot draw into. The compositor takes it out
  of the surface state and releases it once the pixels are out.
- **Input from the chrome is injected on the Wayland thread** through a
  `calloop::channel`; seat and surfaces are not `Send`.

Clients, for testing:

- **kitty** is the GPU/dmabuf client, verified on an AMD iGPU. ~7s from mapping
  to first frame, and it sizes itself to the output unless configured.
- **A GPU client is slow between mapping and drawing.** Anything sampling "did a
  frame arrive" off the map reads zero and blames the compositor.
- **`weston-flower` commits twice and stops** — under real weston too. Not a
  compositor bug. `weston-simple-shm` animates and is the better shm client.
- **`wev` segfaults** here. **`weston-eventdemo` prints no pointer events**; use
  `WAYLAND_DEBUG=1`.
- **In a container there is only llvmpipe**, where no client can allocate a
  dmabuf, so `e2e-dmabuf.sh` stops after asserting the global.

## What a green run does not cover

The dmabuf import, presentation and hardware timing — and why a `skipped` line
reads as loudly as a failure. `AGENTS.md`'s *Checking your work* is where that
is written down.
