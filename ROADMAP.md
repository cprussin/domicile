# Domicile roadmap & handoff

Domicile is a Wayland compositor whose **chrome is a web page**: the desktop —
panels, launchers, window furniture — is web content with full CSS, and app
windows are real elements in it. Read `docs/architecture/ARCHITECTURE.md` (the
why) and `docs/architecture/WINDOW-COMPOSITING.md` (how app windows reach native
cost) before changing anything here.

Built test-first, from the pure-logic core outward to the hardware glue.

---

## Handoff: start here

### Current state

There are **two paths**, and both work. Which one a *window* takes is
`disposition` (`main.rs`), and it is three things rather than one: the
compositor was given a window (`--present`), **and** that client committed a
dmabuf, **and** its CSS is something the shaders can draw. Anything else is the
copy path, one window at a time.

**The native path** — what the architecture is for. The compositor opens a
`winit` window, the chrome connects as an ordinary Wayland client on a socket of
its own, and the compositor draws the desktop itself: each app's dmabuf through
the CSS matrix the chrome reported for its `<app>` element, then the chrome's own
surface over the top. The chrome's page is transparent where an `<app>` is, so
the client shows through the hole. No pixel is copied by the CPU. Verified on
real hardware (AMD Radeon 890M): the desktop renders, a terminal opens into it,
and input reaches both.

**The copy path** — the original prototype, still the fallback for any window
the shaders cannot draw, still what every `wl_shm` client gets however ordinary
its CSS, and still what most of the headless checks drive. The compositor reads
the client's frame back off the GPU and sends the pixels to the chrome over a
Unix socket to be drawn into a `<canvas>`. Correct everywhere. Four full-frame
copies per frame was its cost before damage tracking; a steady-state frame now
reads and sends only what changed, and full-frame is what a first frame, a
resize or a hand-over still costs.

The wire protocol is at `PROTOCOL_VERSION = 1`.

Run the suites for their counts rather than reading one here. A number written
down goes stale on the next commit that adds a test, and this one went stale
four times in a single afternoon of review before it earned its deletion.

### How to run / test

```sh
nix develop                     # core shell: rust + node
cargo test                      # core Rust tests
bun run turbo test              # TypeScript: lint, types, unit tests

nix develop .#full              # adds wayland, mesa, weston, electron, xvfb, kitty
cargo build -p domicile-compositor    # the Smithay server (EXCLUDED from default build)
cargo test -p domicile-compositor      # includes tests/ — a real compositor,
                                       # driven by a stand-in chrome

# Headless end-to-end. No display needed — use these to verify changes.
# `./scripts/check.sh` runs every `e2e-*.sh` and `test-*.sh`, and is the whole
# answer before a push. `smoke-compositor` and `probe-transparency` are below
# but not in that loop — run them by hand.
# Most build the compositor first; `e2e-compose` drives cargo test directly and
# `e2e-chrome-without-a-host` builds no Rust at all. Every one has a flake app, so
# `nix run .#<name>` runs any of them against a fresh checkout.
./scripts/smoke-compositor.sh    # a real client binds our globals
./scripts/e2e-chrome.sh          # client -> host -> mock chrome, and the buffer release
./scripts/e2e-electron.sh        # a real Electron renderer under Xvfb; pixels flow
./scripts/e2e-late-chrome.sh     # a chrome arriving to a client already running (reload)
./scripts/e2e-spawn.sh           # a spawned client is aimed at *our* display
./scripts/e2e-input.sh           # keyboard + pointer reach a client (copy path)
./scripts/e2e-stuck-key.sh       # a key held when the page reloads is not left down in the seat
./scripts/e2e-dmabuf.sh          # the dmabuf global is advertised; with a GPU, frames arrive
./scripts/e2e-slow-chrome.sh     # a chrome that stops reading does not freeze the compositor
./scripts/e2e-two-chromes.sh     # a focus change reaches every chrome, not just the one that moved it
./scripts/e2e-window-alpha.sh    # a translucent client's premultiplied alpha is undone once
./scripts/e2e-hidpi.sh           # a 2x chrome makes a client draw at 2x, and the frame says so
./scripts/e2e-chrome-layer.sh    # the chrome is told from the apps, and keeps the keyboard
./scripts/e2e-compose.sh         # the scene composites into a buffer, checked pixel by pixel
./scripts/e2e-close.sh           # a close request reaches the client, and the window leaves when it goes
./scripts/e2e-chrome-without-a-host.sh   # a chrome whose host socket is dead says so once and stops
./scripts/e2e-two-displays.sh    # one wl_output per configured display, at its own size and scale
./scripts/e2e-reload-displays.sh # a display *added* to the config is taken up while it runs
./scripts/e2e-one-window-per-display.sh # a client is told the one output its window is on
./scripts/e2e-chrome-fills-the-desktop.sh # a real chrome commits at the described desktop's size, and follows it
./scripts/e2e-chrome-fills-a-window.sh # the same where the desktop *is* Domicile's window (--present)
./scripts/e2e-window-follows-the-desktop.sh # a described desktop that grows takes its window with it (--present)
./scripts/e2e-shell-launch.sh    # running the *shell* brings up a compositor and the chrome inside it
./scripts/probe-transparency.sh  # the engine, as our client, commits real alpha

# Needs a real display — run on the user's machine.
nix run 'github:cprussin/domicile#native'      # Domicile: a window, composited
nix run 'github:cprussin/domicile#measure'     # both paths, with the numbers side by side
```

`e2e-compose.sh` needs a GL stack (it gets a software rasteriser where there is
no GPU) but no display: it composites into an offscreen buffer and reads the
pixels back. `e2e-chrome-fills-a-window.sh` and
`e2e-window-follows-the-desktop.sh` are the ones that open a real window, on an
Xvfb, and the only two that pass `--present`. What neither covers
is which way *up* the result is, which needs a screen: see the transform gotcha
below.

### Environment gotchas (these will bite you — read them)

- **Shell is bash**, despite any env note saying nushell.
- **Commits**: gpg signing fails here. Commit with
  `git -c commit.gpgsign=false -c user.name="Claude" -c user.email="noreply@anthropic.com" commit …`
  and end the message with the `Co-Authored-By: Claude …` trailer.
- **Nix + git**: `nix develop` only sees **git-tracked** files. A brand-new
  untracked file makes the flake error with "not tracked by Git" — `git add` it
  first (staging is enough; a dirty tree is fine, just warns).
- **Unix socket path length ≤ ~108 chars (SUN_LEN)**. The session scratchpad path
  is too long — use a **short** `XDG_RUNTIME_DIR` like `/tmp/domicile-rt` for
  anything that binds a wayland/chrome socket.
- **`nix run github:...?ref=<branch>` caches the branch for an hour.** A `nix run`
  right after a push re-runs the *old* revision, with a stale staged copy and its
  already-built binary — which reads exactly like "my fix did nothing". Pass
  `--refresh` whenever the branch is moving.
- **Which way up an output is drawn cannot be tested without a screen.** Smithay's
  projection sends output-y=0 to NDC -1, which is GL's *bottom*, and on a window
  that is the bottom of what the user sees. Reading a buffer back — all a machine
  with no display can do — is consistent either way, so the offscreen pixel tests
  pass under both. The window is drawn with `Transform::Flipped180`; that was
  settled on hardware, so do not "simplify" it back to `Normal`.
- **A solid-colour texture cannot test a texture matrix.** It looks the same
  however it is mapped onto the quad, so a comparison against Smithay's own
  drawing with one checks only where the quad landed. The fixtures in
  `compose::pixels` are patterned for this reason — a y-inversion bug passed a
  solid-texture comparison unchanged.
- **A client's buffer may be upside down, and the types do not say so.** A client
  that renders with GL sets `Y_INVERT` on the dmabuf; Smithay records it on the
  texture but does not expose it, so `Layer::y_inverted` carries it from the
  import. `compose::texture_matrix` reflects (`1 - v`) rather than negating,
  because Smithay's own flip needs a repeating wrap mode to land back in range
  and samples the first row for the whole quad against a clamping one.
- **A global a client wants and does not find is not an error it reports.**
  `wl_data_device_manager` was missing, and it showed up as the chrome freezing
  whenever a tab was dragged: a page that starts an HTML5 drag has the engine
  start a Wayland one, and the engine runs a nested loop until the drag
  completes. Nothing could complete it. Every other client carried on, which
  makes it read as a compositor crash rather than a missing global.
  `smoke-compositor.sh` now checks each expected global by name.
- **A popup must be configured before it can draw**, and a client waiting on its
  own menu has stopped answering anything — the same shape of hang, equally
  silent. `new_popup` sends the configure.
- **Submitting a frame blocks until the display will take it**, so compositing
  must not happen where a change is *noticed*. Drawing once per client commit
  means blocking the Wayland thread once per client commit, and a client that
  commits faster than the display refreshes stops the compositor serving
  anything — every other client freezes, the chrome included, which reads as a
  crash. Commits mark the desktop dirty; the event loop draws at most once per
  pass. Dragging a tab found this: it fires a stream of resizes, each of which
  makes a client redraw.
- **The frame report is on a schedule, so it cannot wait on traffic.** It used
  to be printed by the writer thread as it forwarded, which works only on the
  path that forwards something: the compositing path produced no outbound items
  and so reported nothing at all, however hard it was working. Worse, the only
  reason it *ever* reported was a throttle counter that a later fix set to zero.
- **One seat has one pointer focus, so only one thing may drive it.** The copy
  path has the chrome route the pointer and forward what belongs to a client;
  where Domicile presents, it routes from the window's own events with
  `Scene::route_pointer`. Running both means whichever moved the focus last gets
  the next click — a window that tracks the mouse perfectly and never receives a
  press, so it cannot be focused by clicking it.
- **A shortcut that depends on who has focus is not a shortcut.** The chrome
  claims combinations with `grab_shortcut` and the compositor takes matching
  presses out of the stream in the keyboard filter — before the focused client
  is given them, which is the only place they can be taken from a window that
  has the keyboard. Modifier *toggles* are deliberately not part of a chord:
  matching on caps lock or num lock makes a shortcut stop working when one is on.
- **Never leave the keyboard focused on nothing.** Focusing a window that has
  already closed — the race the chrome loses whenever one goes away while its
  focus message is in flight — used to hand the keyboard to `None`, and nothing
  took it back: the desktop went deaf until restarted. Every focus path falls
  back to the chrome.
- **A client does not have to bind more than one `wl_seat`.** Giving the chrome a
  seat of its own, so it and the apps could hold a focus each, broke Electron:
  `Gdk: gdk_seat_get_keyboard: assertion 'GDK_IS_SEAT (seat)' failed`, then
  `Fatal Wayland communication error: Broken pipe`. One seat, taken in turns.
- **Presenting means the compositor is itself a Wayland client**, so it keeps the
  session's `WAYLAND_DISPLAY` and cannot have a runtime directory to itself the
  way the headless path does — its socket lands in the host's `XDG_RUNTIME_DIR`
  beside the host compositor's. A client we spawn is therefore given
  `WAYLAND_DISPLAY` **explicitly** (`client_command`); inheriting ours opens the
  app on the host desktop, which reads as "the compositor isn't compositing".
  `e2e-spawn.sh` guards this with a decoy display.
- **The cursor the user sees belongs to the session Domicile's window is in.** A
  client asking for a shape is a request to pass on to winit; nothing about it is
  visible otherwise.
- **winit `dlopen`s the Wayland and X11 client libraries**, exactly as libEGL is,
  so `.#full` names them in `LD_LIBRARY_PATH` rather than merely installing them.
  Without them `--present` reports `NoWaylandLib` and opens no window while
  everything headless keeps working — it looks like a compositing bug and is a
  packaging one. `NoCompositor` is the different failure: the library loaded and
  there was no session to nest in.
- **On X11 the missing library is a panic, not a report.** `--present` on an
  X server also needs `libxkbcommon-x11.so.0` — its own library, which
  `libxkbcommon0` never contained, and `xkbcommon-dl` tries the versioned soname
  first, so the package is `libxkbcommon-x11-0` rather than `-dev`. Without it
  the compositor dies in an `expect` that *does* name the library, but out of a
  panic with a raw backtrace, so it reads as a compositor crash rather than a
  missing dependency. Open: it should report the way `NoWaylandLib` does.
- **libEGL is `dlopen`ed, not linked.** `mkShell` only wires *build-time* linkage,
  so `.#full` sets `LD_LIBRARY_PATH` (`/run/opengl-driver/lib` first, so NixOS's
  EGL vendor matches the running kernel driver). Without it the compositor logs
  `no EGL renderer: serving wl_shm clients only` and never advertises dmabuf.
- **`WAYLAND_DEBUG=1` output is ANSI-coloured**, even into a file, and the escapes
  land *between* the interface name and the event. Every script that greps a
  client log sets `NO_COLOR=1`; without it the grep matches nothing and the check
  passes nothing.
- **Do not match a log line by its exact rendering.** `e2e-hidpi.sh` matched
  `advertising output scale scale=2`; adding a field to that line broke the check
  silently. Match the field, not the sentence.
- **The e2e scripts build the compositor themselves.** They used to only check the
  binary existed, so a reworded log line could break a check and still pass
  against a stale binary — which is exactly what happened once. Keep the build.
- **`domicile-compositor` is excluded from `default-members`** (it pulls Smithay +
  native libs). Plain `cargo test`/`cargo build` skip it; build it explicitly.
- **Verifying without nix**: `libxkbcommon-dev`, `weston` and `wayland-utils`
  get most of the headless scripts running outside the nix shell. On top of
  that, and checked against the scripts rather than remembered:

  | also needs | which scripts |
  |---|---|
  | `electron` | `e2e-electron`, `e2e-late-chrome`, `e2e-chrome-without-a-host`, `e2e-window-alpha`, both `e2e-chrome-fills-*` |
  | `xvfb` | `e2e-electron`, `e2e-late-chrome`, `e2e-chrome-without-a-host`, `e2e-chrome-fills-a-window`, `e2e-window-follows-the-desktop` |
  | a GL/EGL stack | `e2e-compose` (a software rasteriser is enough) |
  | `libxkbcommon-x11-0`, `xdotool` | `e2e-chrome-fills-a-window`, `e2e-window-follows-the-desktop` — they open a real window, and there is no WM on an Xvfb to resize it or measure it |

  `.github/workflows/e2e.yml` installs a superset: Electron's own runtime libs
  (`libnss3`, `libatk*`, `libcups2`, …) and the mesa packages are in there too.
  Read that list rather than this one when a CI-only failure looks like a
  missing package.
- Reference material for Smithay: fetch from `github.com/Smithay/smithay` tag
  **`v0.7.0`** (smallvil + anvil examples, `src/input/*`, `src/wayland/*`).

### Smithay 0.7 specifics we learned

- **Keycodes need `+8`** (evdev → xkb) — but only from the chrome, which sends
  evdev. The winit backend has already added it, so a key from the window is
  passed through as it arrives.
- **Must flush clients** after dispatch *and* after off-thread input, or clients
  hang. The `Display` lives in `CalloopData` and we `flush_clients()` in the
  `event_loop.run` callback.
- **Need a `wl_output` global** or many clients won't map a toplevel
  (weston-terminal, kitty wait for it). `weston-flower` / `weston-smoke` /
  `weston-eventdemo` map fine and are good shm test clients.
- **Send `wl_surface.enter`.** A toolkit that scales its content asks which output
  a surface is on before drawing anything — GLFW (and so kitty) blocks on exactly
  this, mapping a window that stays blank.
- **A v3 dmabuf global is not enough for Mesa.** The format list says *what* a
  client may allocate, never *which GPU*. Mesa learns that from `wl_drm` (not
  advertised) or v4 feedback's `main_device`, so a v3-only global leaves it
  unable to pick a device. Feedback is built from the `dev_t` of the EGL device's
  render node; a software rasteriser has none and falls back to v3.
- **Buffers must be released.** Smithay only releases the *previous* buffer when
  the next is committed — which is the buffer the client cannot draw. The
  compositor takes the buffer out of the surface state and releases it once the
  pixels are out of it. `e2e-chrome.sh` asserts it.
- **`winit::init` hands back an event loop, and dropping it is silent.** The
  window still opens and draws; it just never hears a pointer or a key, which
  reads as a compositor that has hung rather than a wire-up that is missing.
- Input from the chrome is injected on the **Wayland thread** via a
  `calloop::channel` (seat + surfaces aren't `Send`). Chrome connections run on
  their own threads and push onto that channel.

### Client quirks (for testing)

- **`weston-eventdemo` does NOT print pointer events to stdout.** Use
  `WAYLAND_DEBUG=1` and grep for `wl_pointer#N.button` / `wl_keyboard#N.key`.
- **`wev` segfaults** on our minimal compositor — don't use it.
- **`weston-flower` is not an animating client here.** It commits twice and stops,
  under real weston too — don't read a frozen flower as a compositor bug.
  `weston-simple-shm` animates properly and is the better shm client for
  frame-rate work.
- **`kitty`** is GPU/dmabuf, verified on an AMD iGPU. It takes ~7s from mapping to
  its first frame (font cache, GPU init), and sizes itself to the output unless
  configured. In a container it only ever reaches llvmpipe, where no client can
  allocate a dmabuf, so `e2e-dmabuf.sh` stops after asserting the global.
- **GPU test clients**: `weston-simple-dmabuf-egl` is the smallest, but nixpkgs
  builds weston with `simple-clients` off, so `e2e-dmabuf.sh` falls back to kitty.
- **A GPU client is slow between mapping and drawing.** Anything that samples "did
  a frame arrive" off the map will read zero and blame the compositor.
- **`nix run` stages the git source, so there is no `node_modules`.** Every e2e
  script drives a bun harness that imports the workspace packages; the flake's
  runner installs before running.

### What the instrumentation says

The compositor logs one INFO line every 5s while compositing, so "is it faster"
is a number rather than an impression:

```
frames sent=N composited=CN dropped=M fps=F mb_per_s=B write_ms=W \
       readback_ms=R readback_worst_ms=RW commit_ms=C \
       composite_ms=CM composite_worst_ms=CMW submit_ms=S submit_worst_ms=SW \
       idle_ms=I response_ms=RS response_worst_ms=RSW throttled=T chromes=K
```

- `readback_ms` — the GPU copy. **Zero for a window drawn natively**, because it
  does not happen: that is the whole point. Per window, not per run — so this
  answers "what is still on the copy path" rather than "which path is running".

  Everything it does is the size of the region about to be sent — the offscreen
  it allocates, the blit that resolves the client's format, and the copy out —
  so it scales with what the client changed rather than with the size of its
  window. A full-window
  figure means a frame the chrome could not patch (a first frame, a resize, a
  hand-over) or a client that reported no damage.

  Measured on llvmpipe at 1920x1080: 11.0ms for the whole buffer, 4.7ms for
  half of it, 0.13ms for a 32x32 patch. Narrowing *only* the copy out — with
  the offscreen and the blit left full-size — measured 8.6-9.1ms for that same
  32x32 patch, which is to say indistinguishable from not narrowing at all. A
  software rasteriser flatters the blit's share, so the split will differ on
  hardware; what will not is that a partly-narrowed readback reports the
  unnarrowed part in this same number.
- `commit_ms` — the whole Wayland-thread commit; minus `readback_ms` it is
  everything around the copy.
- `idle_ms` — the gap between one commit finishing and the next arriving. Large
  means *waiting*, not working. `idle + commit ≈ 1000/fps` is the self-check on
  the *copy* path, where a frame is a client commit; the native path counts
  composites instead, and the check below is that path's.
- `composite_ms` — the drawing: the scene read, the hand-over and the draw
  calls. It stops before the submit, so the frame-callback wait is no longer
  inside it. Neither field is a whole cost: GLES hands work to the driver
  rather than doing it, so this under-reports the GPU's share and `submit_ms`
  carries it. The self-check is `composited × composite_ms`, which must
  fit inside the reporting interval — when it did not (seven composites
  averaging 1434ms inside five seconds) the submit was being counted as
  compositing. Two things that are still in scope and are *not* the
  compositor's drawing: `hand_over_to_the_engine`'s `glReadPixels`, which
  stalls on the GPU when a window leaves the native path, and the host lock,
  which is bounded because no holder of it waits on a chrome. **Unverified:**
  whether the frame-callback throttle really lands in the submit on this
  stack. Mesa's wayland-egl can instead block acquiring the *next* frame's back
  buffer, which is inside `composite_ms` — in which case the wait relocates
  rather than being quarantined, and the self-check above is what says so.
- `submit_ms` — `eglSwapBuffers`, plus the driver's share of the drawing above.
  Large is the *normal* reading for a window nobody is looking at, so it is a
  caveat on `composite_ms` before it is a cost — but it is not pure idleness
  either, and the two cannot be separated from outside.
- `response_ms` — from injecting a keystroke into a client to that client's next
  commit: the client's own think-and-redraw, isolated. It is measured entirely
  inside the compositor, so it is the one figure directly comparable between the
  two paths.
- `throttled` — commits the ~30fps throttle refused (copy path only).

The chrome reports on the same cadence and the same stdout, on two lines —
the round trip is per keystroke and placement is per window per frame, so they
are different subjects and each is silent when nothing happened to it:

```
chrome: round trip keys=N rt_ms=R rt_worst_ms=RW \
        frames=F ipc_ms=I ipc_worst_ms=IW draw_ms=D draw_worst_ms=DW
chrome: placements=P place_total_ms=PT place_ms=PA place_worst_ms=PW
```

`rt_ms` is the number behind "sluggish": key press to pixels on screen. Taken
after the frame handler runs, so the draw is inside it. `ipc_ms` and `draw_ms`
are the two stages the compositor cannot see. On the native path there are no
frames on the socket at all, so these fall silent — which is the result, not a
gap in the measurement.

`placements` counts measurements rather than frames, because every mounted
window is measured on every animation frame — so a desktop with twenty windows
pays it twenty times a frame, and `place_total_ms` against the reporting
interval is the fraction of a core that costs. `place_worst_ms` is the one to
hold against a dropped frame, with the caveat that a measurement which also
*sent* a placement includes the send, so the worst sample is usually one of
those rather than a measurement on its own.

Two rules the numbers depend on, both learned the hard way:

- **Key presses only, never releases.** A release changes nothing on screen, so
  the next frame is some unrelated redraw — a terminal's blinking cursor, half a
  second later. Counting them contaminated half of every sample and put a fake
  ~500ms tail on both `rt_ms` and `response_ms`. If a latency number grows a tail
  at suspiciously exactly some client's idle redraw period, suspect the
  measurement before the client.
- **Throughput and latency are different questions.** `fps=2` on an idle terminal
  is not slow — it redraws once per cursor blink. A keystroke taking 300ms looks
  identical in that line.

Measured on the copy path, AMD 890M, kitty at ~1500x1000: `rt_ms≈100`,
`ipc_ms≈19`, `draw_ms≈1`, compositor ≈11ms — and later, on a full-screen window,
`ipc_ms≈79` with a worst case of 237.

`ipc_ms` was once written down here as *unfixable* in Electron, on the grounds
that every main→renderer path types its transfer list as `MessagePortMain[]`, so
the bytes are structured-cloned rather than transferred. That is true of the
hop and false of the conclusion: the hop is avoidable by not having one. The
preload runs in the renderer process and, unsandboxed, can hold the compositor
socket itself, so a frame's bytes are read where they are drawn.

What is left is the context bridge's own clone into the page, which is
in-process. Probed under Electron 41 on 5.94MB — a 1494x994 frame — on the
container the checks run in:

| route | per frame |
|---|---|
| main → renderer over Electron IPC | 29.4ms avg, 39ms worst |
| preload → page over the context bridge | 13.6ms avg, 22ms worst |
| preload → page in one world (`contextIsolation: false`) | 0ms |

The third row is available and not taken: it trades the isolated world for the
copy, and with damage tracking a steady-state frame is a patch rather than a
window. It is the lever to pull if full frames — a resize, a first frame, a
hand-over — turn out to matter more than the isolation does.

What moved with the socket is the reading of it: the stream reassembly in
`host-stream` now runs on the renderer's only thread, the one that also handles
the keyboard, where it used to be another process's. It is inside `ipc_ms` —
the stamp is taken at the top of the `data` handler, before the chunk is read —
so the number stays honest, but it is the thread to watch if that number stops
falling.

### Repo layout

| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema/parse/validate, hot-reload (keep last-good) | core |
| `packages/domicile-scene` | affine transforms + inverse, hit-testing, pointer routing, z-order, draw order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages (JSON), versioning | core |
| `packages/domicile-host` | orchestrator `Host` brain + `ipc` (handshake, `apply_chrome_message`) | core |
| `packages/domicile-bridge` | app → external-image id + latest dmabuf bookkeeping (pure) | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server, chrome socket, dmabuf/shm import, compositing, input | `.#full` |
| `packages/chrome-sdk` | `<domicile-app>`/`<domicile-webview>` elements, `BridgeClient`, matrix/frame/input/protocol helpers | bun |
| `packages/e2e-harness` | headless chrome stand-ins for the `scripts/e2e-*.sh` checks | bun |
| `packages/test-support` | shared bun test setup (happy-dom + jest-dom matchers) | bun |
| `packages/electron-chrome-host` | the shell's process side: starting the compositor, the launcher, the window, failure reporting | bun |
| `packages/domicile-launch` | the boundary between a shell and the compositor it runs: the command line, and the session the compositor publishes (pure) | core |
| `packages/component-library` | the shared React components and Panda preset the shells are built from | bun |
| `packages/shell-manganese` | the reference chrome: tabs, stage, rail, address bar | bun |
| `packages/shell-simple` | the minimal chrome: floating windows only | bun |
| `scripts/` | `check.sh` (runs everything), the e2e + smoke checks, `run-native.sh`, the two `measure` runs, and the `xvfb-*` helpers they share | — |

Inside `domicile-compositor`: `compose.rs` is the drawing (layers, the CSS matrix
as the renderer's, desktop↔target mapping, where the chrome lands) and is where
the offscreen pixel tests live; `screens.rs` is what the desktop is made of and
how a reloaded display list is matched against the running one; `damage.rs` is
which rectangles changed between two frames; `dmabuf_import.rs` is the import and
the readback; `scale.rs` is the output scale arithmetic; `outbound.rs` is the copy
path's queueing policy; `coalesce.rs` is the config watcher's settling;
`shortcut.rs`, `straight_alpha.rs`, `timing_window.rs` and `dmabuf_descriptor.rs`
are each one small thing named after it.

### How input & pixels actually flow

**Native path.** A client commits a dmabuf → the compositor imports it as a
texture and keeps it → on every commit it draws the whole desktop: apps in
`Scene::draw_order` through `Portal::surface_to_output`, then the chrome's own
surface over them, blended, so its transparent regions are the holes the apps show
through. Nothing is copied by the CPU. The chrome is told from an app by which
Wayland socket it connected on (`<display>-chrome`).

Input: the window's events → the seat. The pointer is routed by the compositor
through `Scene::route_pointer`, and a press focuses what is under it. The keyboard
goes to whatever holds focus — the chrome until it says a window has been focused.

**Copy path.** A client commits → the compositor reads the buffer back (shm
directly, dmabuf via `read_rgba`) → `HostMessage::AppFrame` over the socket, raw
bytes after the header line → `<domicile-app>.drawFrame` → `<canvas>`. Throttled
~30fps. Input arrives as chrome messages and is injected into the seat.

Two rules the copy path is built around, both from freezes:

- **Never write to a chrome from the Wayland loop.** Frames are big; a chrome that
  reads slowly fills the socket buffer within a frame or two, and a blocking write
  there stops frame callbacks and freezes *every* client.
- **Never *wait* on a chrome either.** A bounded queue with a blocking fallback
  stalls the same thread, which also injects input — past the 200ms repeat delay,
  so a key the user tapped starts repeating. Frames and lifecycle messages need
  opposite policies (`outbound.rs`): drop frames past a shallow cap, never drop or
  wait on messages. `e2e-slow-chrome.sh` holds the line.

---

## Where this is going

The plan lives in `docs/architecture/WINDOW-COMPOSITING.md`; this is the summary.

### Phase 1 — one window composites natively ✅

Done, and measured. On an AMD 890M with kitty, the compositor's work per frame
goes from ~35ms (8 on the Wayland thread, 27 on the writer thread) to under a
millisecond, and 80–123 MB/s of socket traffic to zero, while `response_ms` —
the client's own redraw — is unchanged. The full table is in
`docs/architecture/WINDOW-COMPOSITING.md`.

To take it again, on a machine with a display:

```sh
nix run 'github:cprussin/domicile#measure'
```

It runs each path in turn on the same client at the same size, types a fixed
number of keystrokes into it, and prints what each reported. The keystrokes are
injected over the chrome socket rather than typed, so the two runs are comparable
and neither is hand-timed; they are spaced, because both measurements take the
oldest unanswered keystroke and a burst would be counted once.

`rt_ms` and `ipc_ms` are *not* measured by it, on either path: both are timed by
the chrome from the keystroke it sent, and the harness types over the socket. Do
not read their absence as a result — the result is `sent=0`, which is what says
nothing crosses the hop they measure.

Taken again after the shadow work, to see what a per-pixel blur costs. Both
paths were re-run, so the copy column is a fresh measurement rather than the one
above — same machine, same client, same forty keystrokes, and it drifts by a
millisecond or two from run to run.

The copy column is from before damage tracking, so `readback_ms`, `write_ms`
and `mb_per_s` are all the whole-window case: what a first frame, a resize or a
hand-over still costs, rather than what a steady-state frame does:

| per frame | copy | native, before shadows | native, with them |
|---|---|---|---|
| `readback_ms` | 8 (worst 10) | 0 | 0 |
| `write_ms` | 25-26 | 0 | 0 |
| `commit_ms` | 7-8 | 0 | 0 |
| `composite_ms` | 0 | 0 (worst 2-3) | 0-1 (worst 1-2) |
| `mb_per_s` | 80-123 | 0 | 0 |
| `response_ms` | 3-4 (worst 5) | 3-4 (worst 6) | 4 (worst 4-5) |

Measured before `composite_ms` and `submit_ms` were split, so the figures here
include the buffer swap and are not directly comparable with a run from after
it — they are an upper bound on what the same work costs now.

The blur is free. `composite_ms` was the number to watch, because a shadow is
the first effect that runs work per pixel rather than per quad, and it did not
move — the worst case is if anything lower than it was before shadows existed,
which is noise rather than an improvement. Re-run this whenever an effect lands
that samples more than once per pixel; a real blur, rather than the one-tap
falloff the shadow uses, is the next candidate to move it.

### Phase 2 — the effects that make an app a CSS element

- ~~rounded corners, opacity and shadow in the compositor's shader~~ — done.
  `place_portal` carries the element's computed `border-radius`, `opacity` and
  `box-shadow`; the shader rounds and fades the client's own buffer, and a
  second quad under it casts the shadow.
- ~~the rotated + rounded + shadowed window that was the original success
  criterion, drawn correctly~~ — done. `compose.rs` has pixel tests for a window
  turned 45 degrees covering the diamond it should, rounded by a length on the
  screen rather than a fraction of itself, and casting its shadow the way it
  faces.
- ~~the same window **at native cost**~~ — done, and the blur is free.
  `composite_ms` reads 0-1ms after shadows landed, worst case 1-2ms against the
  2-3ms measured before they existed. The full table is under Phase 1 above.
- a **rotated non-square window**. `compose::on_screen_size` reads the matrix's
  rows; reading its columns instead is numerically identical for anything
  axis-aligned and swaps width for height on anything turned, and every turned
  fixture is square, so nothing in the repo can tell the two apart. Needs a
  non-square `turned` fixture rather than another assertion on the one there.
- interleave chrome and windows by CSS `z-index` — the shell writes `z-index`
  and the compositor honours it, in the stacking space the portals are already
  reported in. **Half done.** `compositor/src/stacking.rs` decides where the
  chrome goes among the windows, and `Layer::clip` confines each of its depths
  to the region that depth occupies. What is missing is the depths themselves:
  the chrome knows them and the protocol carries no message for them, so every
  frame is still the all-above case.

  Ordering is not the whole answer and cannot be. Where chrome above a window
  and chrome below it cover one pixel, the page flattened that texel before we
  saw it — a translucent panel over a window with a wallpaper behind it, which
  needs one window and no overlap. A raster per band is what closes that, and
  its transport is settled in `WINDOW-COMPOSITING.md` and the compositor's half
  is built (`bands.rs`): the page cannot tag its own commits, because the
  Wayland connection belongs to Chromium rather than to the page, so the
  compositor asks for one band at a time and takes the next commit as the
  answer — which obliges a chrome that declares depths to commit nothing else
  while one is outstanding. What is missing is a chrome that declares any: the
  SDK can send `declare_bands` and nothing calls it, so every frame is still
  the all-above case.
- ~~follow a window that moves~~ — done. `<domicile-app>` re-measures on every
  animation frame rather than on a `ResizeObserver`, which sees a box change
  size and nothing else: moving a window, animating a transform, a `:hover`
  filter and a class toggle all leave the size alone and all change where or
  how the compositor must draw it. One loop for every portal, and a window that
  did not move sends nothing.
- ~~per-window fallback to the copy path when a computed style needs an effect
  the shader cannot do~~ — done, and it is what makes the native path safe to
  leave on: correct always, fast almost always. `<domicile-app>` reads its own
  computed style, names anything the shaders have no answer for, and sends
  `native: false` with the placement; the compositor draws nothing for that
  window and reads its buffer back as it always did. One window, not the
  desktop — a blur on one app costs that app. The author is told on the console
  what it cost them, once per property.
- a window on the copy path is drawn *above* every natively-drawn window it
  overlaps, whatever its `z-index`, because the page is composited over all of
  the app surfaces rather than in the stacking order. Interleaving by
  `z-index` fixes this and chrome-between-two-windows together.
- ~~a window swallows the *clicks* meant for whatever the chrome painted over
  it~~ — done, by the page saying so. Routing is a hit test against a
  rectangle, and a rectangle cannot see that the engine drew a menu, a dialog
  or a browser tab on top; the window under it won every click, and because the
  click that hands the keyboard back to the chrome is one the chrome has to
  *receive*, it won the way out too — nothing on the stage could be clicked
  again. `<domicile-app>` reports its `pointer-events` with the placement and
  the compositor passes an inert window over. Drawing needed no fix for this
  case: the chrome is composited over every app surface already, which is why
  only chrome-*above* is free today. Three things it does not do:
  - **it introduces a disagreement of its own.** An inert window is still
    drawn, and still on top of the windows below it, while its clicks now go
    to one of them. Where two app windows overlap and the upper is inert, what
    you see on top is not what you click.
  - **all-or-nothing per window.** `pointer-events` is per element, so a menu
    over one corner makes the whole window unclickable. Right for a dropdown
    with a backdrop, wrong for a popover meant to leave the window usable, and
    no partial answer is available from this signal.
  - **the keyboard is untouched.** `Scene::keyboard_target` ignores
    `takes_pointer` and the compositor only re-points the keyboard on a click,
    so a chrome that opens a menu over the focused window *from a shortcut*
    leaves every keystroke going to the window.

  No shell in the tree sets `pointer-events: none` yet — the routing model was
  wrong on its own terms, and `claude/demo-tab-transition` is what exercises
  it.
- a window rejoining the native path is drawn from the texture it left on until
  its client next commits. Invisible while the element survives the transition,
  because the canvas holds fresher pixels and stays up until there is something
  better — but not when the element is remounted, where the canvas is gone.
  `latest_frames` holds the current buffer as `LastFrame::Gpu`, so re-importing
  on the way back is the fix whenever it is worth taking.
- ~~every mounted window is measured on every animation frame~~ — measured, and
  it is cheap. From `scripts/measure.sh` on hardware, steady state:

  | | placements / 5s | `place_total_ms` | `place_ms` | share of a core |
  |---|---|---|---|---|
  | copy path | 518-550 | 40-57 | 0.07-0.11 | 0.8-1.1% |
  | native path | 299 | 18-22 | 0.06-0.07 | 0.4% |
  | idle desktop | 134 | 6 | 0.05 | 0.12% |

  The worry was that a twenty-app desktop pays a `getBoundingClientRect`, a
  `getComputedStyle` and some twenty computed-property reads for nineteen
  `display: none` elements per frame to learn they are still hidden. At 0.07ms
  a measurement that is 20 x 60 x 0.07 = 84ms a second, 8% of a core, with
  every window mounted and the loop at full rate. The early-out for a boxless
  element does not earn its complexity against that.

  One artifact worth not misreading: the **first** interval of each run shows
  `place_worst_ms` at 193-251ms and a `place_total_ms` an order up (218-310).
  That is the first measurement of a freshly laid-out page, not steady state —
  every interval after it is in the table above. `place_worst_ms` stays on the
  diagnostics line so a shell whose per-frame styling makes a single
  measurement expensive says so.
- a client that changes **buffer type** on the same surface — dmabuf commits,
  then a `wl_shm` one — replaces its retained buffer with the shm frame's
  pixels, while the bridge's descriptor still names the buffer's raw fds. The
  descriptor contract says a caller keeping one must keep the buffer alive too,
  and the compositor no longer does. Latent: nothing outside `domicile-bridge`'s
  own tests reads the descriptor, and the client's `wl_buffer` holds the fds
  until it destroys them. Narrow trigger, mostly a toolkit falling back off the
  GPU.
- a hand-over the chrome was too busy to take waits for the next reason to
  redraw rather than for the queue to drain. The chrome's own repaint supplies
  one in practice, since its CSS just changed, but nothing orders the two. Wants
  a redraw when the queue drains, not a poll.

### Phase 3 — own the display

DRM/KMS backend and direct scanout for a fullscreen app, and per-monitor
scanout — one composite clipped per output, which is what a single spanning
page implies once there is real hardware under it. Clipboard/data-device, touch
and a security review all live here too.

Damage *reporting* is done: a frame says which rectangles changed rather than
`None`. Drawing only the damage is the other half and is not — it needs buffer
age, and it needs a screen before anyone should believe it.

### Known gaps in what is built

- **A frame in which the chrome repainted reports the whole output as
  damaged.** The chrome is one layer covering the desktop, so its commit
  counter moving damages all of it — and it repaints for a clock, a caret, a
  hover. Per-surface damage rectangles are already taken from every commit
  (`take_damage`) and dropped for the chrome — but using them needs more than
  plumbing at that call site: `Painted` holds one rectangle per layer, so
  partial-layer damage is a shape `damage.rs` does not have, along with the
  buffer-to-output mapping and the accumulation across frames `present` did not
  run for.
- **An empty damage list saves nothing on the nested path.** Smithay's winit
  `submit` treats `Some(empty)` the same as `None` and swaps the whole buffer,
  so an idle desktop costs what a busy one does. The distinction is real at the
  protocol level and will be acted on by the DRM backend; today the saving is
  only in frames that report *some* rectangles.

- **A client that draws its own cursor into a surface gets a plain arrow.**
  Compositing that surface is the same work as compositing any other.
- **`e2e-chrome-layer.sh` focuses a window that was never placed.** Its
  `focus-probe.ts` sends `focus_app` without a `place_portal`, and
  `Scene::focus_app` refuses an app with no portal — the same silent no-op
  `input-injector.ts` had. The script *does* assert on focus, in three places,
  and passes anyway: those assertions read the **seat**, which
  `ClientRequest::KeyboardFocus` moves before the brain is consulted at all. So
  the brain's `Scene::focus` never leaves the chrome and nothing notices.
  Fixing it widens what that check covers, which is its own change.
- **A mixed-density desktop is drawn at one density.** The chrome is one page
  spanning every display (see ARCHITECTURE's decision on that), so it
  rasterises at a single `devicePixelRatio` — the largest of the outputs its
  toplevel entered, which is the right one to pick. What is lost is the last
  step: `present` composites once into the nested window, so every display is
  drawn at that window's scale rather than at its own.

  The arithmetic for the fix exists and is proven pixel-wise —
  `compose::desktop_to_target` maps the desktop onto *one target*: a
  framebuffer and the region of the desktop it shows, at that target's own
  resolution. `logical_to_window` is now the case where the one target shows
  everything, so the nested path and a per-display path cannot drift apart.
  `a_display_is_drawn_into_a_target_of_its_own_at_its_own_density` renders a
  scale-2 display into its own mode and fails if it is drawn at the desktop's
  density instead.

  What is missing is a framebuffer per monitor to point it at, which is
  per-monitor scanout in phase 3.

  The loop in `present` is not written yet, and not only because it would gain
  nothing against a single window — though it would not: that window has one
  resolution, so each display's region gets the pixels it occupies whichever
  way it is drawn. The other half is that clipping to display regions is not a
  no-op. `Screens::size` is the *bounding box* of the outputs and gaps between
  them are legal — two monitors of unequal height leave one, which is the
  common case rather than an exotic one — and today everything in that gap is
  drawn, including the chrome's own background. A per-display loop rasterises
  the union of the displays instead, so the gap stops being drawn. That is a
  decision about what a desktop *is* between its screens, and it wants making
  where it can be seen rather than inferred from an offscreen buffer.

  Every display at the same `scale` costs nothing regardless; unequal ones mean
  one screen is drawn for the other's until phase 3.
- **A reloaded display list acts on the displays alone.** The list
  itself is no longer fixed at startup: the compositor watches its config, and
  a display added, removed, renamed or reshaped is taken up while it runs —
  `Screens::rearranged_into` decides which `wl_output`s survive, and a display
  that only changed shape keeps the one it had rather than being unplugged and
  plugged back in. `e2e-reload-displays.sh` drives the *added* display end to
  end; reshape, rename and remove are `rearranged_into`'s unit tests only.

  A reload now also asks the host for a window the size of the desktop it
  describes — `Screens::window_showing_it`, the same question asked at startup,
  asked again because the desktop is not the same one. Still bounded by
  `compositor.nested_size`, so a desktop past that ceiling is shown scaled
  rather than asked for at a size no screen holds.
  `e2e-window-follows-the-desktop.sh` drives it: `--present` under an Xvfb, and
  `xdotool` reads the window's size back off X rather than believing a log
  line the compositor writes once at startup.

  The *unconfigured* case is left alone, and now deliberately rather than
  incidentally: with no `output.displays` the window is the desktop, and
  its size and density come from the host, which the config does not know. So
  `Screens::reloaded_into` answers "leave it be" there instead of rebuilding
  from the file — which it did at first, quietly undoing an adopted scale 2 on
  any save in the config's directory.

  **Only the display list is acted on.** A reloaded `output.max_scale`, keymap
  or chrome package is stored and keeps its startup value. `max_scale` is the
  one that looks like it should work and does not.

  Two smaller edges, both in the direction of doing too little rather than the
  wrong thing. A config that *stops* describing displays hands the desktop back
  to the window as `compositor.nested_size` at scale 1 — not at the window's
  actual size and density, which only `adopt_window_scale` knows and which it
  applies on the next resize, whenever that is. And a retired display's global
  is removed without a `wl_surface.leave` first, so a client on it learns
  through `wl_registry.global_remove` alone; toolkits cope, but a compositor
  with a screen to test against should send the leave.
- **Fractional scaling.** Non-integer ratios round *up* to the next integer scale:
  a client drawing more pixels than the display has is downscaled and stays sharp,
  while one drawing fewer is stretched. Matching a ratio exactly needs
  `wp_fractional_scale_v1`, which is a separate protocol and not done.
- **3D transforms above a window.** `defaultMeasure` walks the flat tree and
  composes every 2D transform between an element and the screen, so a rotated or
  skewed *ancestor* is followed. Only the 2D part of a `matrix3d` above one
  survives — which is what the engine draws where that ancestor flattens, the
  default, and is not where `transform-style: preserve-3d` or a `perspective`
  above it projects the descendant instead. `unsupportedEffects` reads the
  element's own style, so the wrong case still claims it can be drawn natively.
  Closing that is now cheap rather than impossible — the walk already holds
  each ancestor's computed style — but it is the same decision as reporting an
  ancestor's `filter`, which would take every window inside a filtered
  container off the native path.
- **`zoom`, on a window or above it.** It scales the box but is not a
  transform, so nothing composes it. The element's own `zoom: 2` is reported as
  no scale at all *and* at half the size the page paints, so the compositor is
  told two wrong things about one window. An ancestor's is worse than a scale
  error: the anchoring subtracts an un-zoomed bounding corner from a zoomed
  rect, so the window is mispositioned too — 40px out for `zoom: 2` over a
  `rotate(30deg)`.
- **Hot-swapping the chrome page** is the shell's to do now — it owns its own
  Electron process — and no shell does it.
- **A desktop that follows the shell's config** is wired on the compositor's
  side (it watches the file it was given) and unreachable on the shell's:
  `launchShell` writes that file into a private directory and returns no path
  to it. `RunningCompositor` needs to carry the path, or `launchShell` needs to
  take one.

---

## Collaboration notes

The user "vibecodes": proceed autonomously, follow your own recommendations,
don't stop to ask unless genuinely blocked on their taste or hardware. Keep
strict TDD. Commit freely, and open a PR for every change.

A standing lesson from this project: **the checks that can run here cannot see a
screen.** Orientation, presentation and anything about what a display does with a
buffer are settled on the user's machine, and the honest move is to say which
question a run would answer rather than guess between two and spend a round trip
per guess.
