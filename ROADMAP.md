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

There are **two paths**, and both work. Which one runs is decided by whether the
compositor was given a window (`--present`).

**The native path** — what the architecture is for. The compositor opens a
`winit` window, the chrome connects as an ordinary Wayland client on a socket of
its own, and the compositor draws the desktop itself: each app's dmabuf through
the CSS matrix the chrome reported for its `<app>` element, then the chrome's own
surface over the top. The chrome's page is transparent where an `<app>` is, so
the client shows through the hole. No pixel is copied by the CPU anywhere in
that path. Verified on real hardware (AMD Radeon 890M): the desktop renders, a
terminal opens into it, and input reaches both.

**The copy path** — the original prototype, still the fallback and still what
every headless check drives. The compositor is headless, reads each client's
frame back off the GPU, and sends the pixels to the chrome over a Unix socket to
be drawn into a `<canvas>`. Correct everywhere, and four full-frame copies per
frame.

The wire protocol is at `PROTOCOL_VERSION = 4`.

**Tests:** 96 core Rust + 46 in `domicile-compositor` (5 more behind `--ignored`,
run by `e2e-compose.sh`) + 353 TypeScript. Clippy clean, `cargo fmt` clean.

### How to run / test

```sh
nix develop                     # core shell: rust + node
cargo test                      # core Rust tests
bun run turbo test              # TypeScript: lint, types, unit tests

nix develop .#full              # adds wayland, mesa, weston, electron, xvfb, kitty
cargo build -p domicile-compositor    # the Smithay server (EXCLUDED from default build)
cargo test -p domicile-compositor

# Headless end-to-end. No display needed — use these to verify changes.
# Each builds the compositor first (e2e-compose drives cargo test directly);
# `nix run .#<name>` runs any of them against a fresh checkout.
./scripts/smoke-compositor.sh    # a real client binds our globals
./scripts/e2e-chrome.sh          # client -> host -> mock chrome, and the buffer release
./scripts/e2e-electron.sh        # a real Electron renderer under Xvfb; pixels flow
./scripts/e2e-spawn.sh           # a spawned client is aimed at *our* display
./scripts/e2e-input.sh           # keyboard + pointer reach a client (copy path)
./scripts/e2e-dmabuf.sh          # the dmabuf global is advertised; with a GPU, frames arrive
./scripts/e2e-slow-chrome.sh     # a chrome that stops reading does not freeze the compositor
./scripts/e2e-hidpi.sh           # a 2x chrome makes a client draw at 2x, and the frame says so
./scripts/e2e-chrome-layer.sh    # the chrome is told from the apps, and keeps the keyboard
./scripts/e2e-compose.sh         # the scene composites into a buffer, checked pixel by pixel
./scripts/probe-transparency.sh  # the engine, as our client, commits real alpha

# Needs a real display — run on the user's machine.
nix run 'github:cprussin/domicile#native'      # the native path: a window, composited
nix run 'github:cprussin/domicile#prototype'   # the copy path, for comparison
nix run 'github:cprussin/domicile#measure'     # both, with the numbers side by side
```

`e2e-compose.sh` needs a GL stack (it gets a software rasteriser where there is
no GPU) but no display: it composites into an offscreen buffer and reads the
pixels back. Presentation is the part it cannot cover — see the transform gotcha
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
- **Verifying without nix**: the headless scripts need `libxkbcommon-dev`,
  `weston` and `wayland-utils`. With those, everything except `e2e-electron.sh`
  runs outside the nix shell; that one also needs `electron` on `PATH`.
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
frames sent=N dropped=M fps=F mb_per_s=B write_ms=W \
       readback_ms=R readback_worst_ms=RW commit_ms=C idle_ms=I \
       response_ms=RS response_worst_ms=RSW throttled=T chromes=K
```

- `readback_ms` — the GPU copy. **Zero on the native path**, because it does not
  happen: that is the whole point.
- `commit_ms` — the whole Wayland-thread commit; minus `readback_ms` it is
  everything around the copy.
- `idle_ms` — the gap between one commit finishing and the next arriving. Large
  means *waiting*, not working. `idle + commit ≈ 1000/fps` is the self-check.
- `response_ms` — from injecting a keystroke into a client to that client's next
  commit: the client's own think-and-redraw, isolated. It is measured entirely
  inside the compositor, so it is the one figure directly comparable between the
  two paths.
- `throttled` — commits the ~30fps throttle refused (copy path only).

The chrome reports the round trip on the same cadence and the same stdout:

```
chrome: round trip keys=N rt_ms=R rt_worst_ms=RW \
        frames=F ipc_ms=I ipc_worst_ms=IW draw_ms=D draw_worst_ms=DW
```

`rt_ms` is the number behind "sluggish": key press to pixels on screen. Taken
after the frame handler runs, so the draw is inside it. `ipc_ms` and `draw_ms`
are the two stages the compositor cannot see. On the native path there are no
frames on the socket at all, so these fall silent — which is the result, not a
gap in the measurement.

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
`ipc_ms≈19`, `draw_ms≈1`, compositor ≈11ms. `ipc_ms` is *unfixable* in Electron —
every main→renderer path types its transfer list as `MessagePortMain[]`, so the
bytes are structured-cloned, never transferred. Deleting it is what the native
path is for.

### Repo layout

| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema/parse/validate, hot-reload (keep last-good) | core |
| `packages/domicile-scene` | affine transforms + inverse, hit-testing, pointer routing, z-order, draw order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages (JSON), versioning | core |
| `packages/domicile-host` | orchestrator `Host` brain + `ipc` (handshake, `apply_chrome_message`) | core |
| `packages/domicile` | host daemon / control plane | core |
| `packages/domicile-bridge` | app → external-image id + latest dmabuf bookkeeping (pure) | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server, chrome socket, dmabuf/shm import, compositing, input | `.#full` |
| `packages/chrome-sdk` | `<domicile-app>`/`<domicile-webview>` elements, `BridgeClient`, matrix/frame/input/protocol helpers | bun |
| `packages/e2e-harness` | headless chrome stand-ins for the `scripts/e2e-*.sh` checks | bun |
| `packages/test-support` | shared bun test setup (happy-dom + jest-dom matchers) | bun |
| `scripts/` | e2e + smoke + the two launchers | — |

Inside `domicile-compositor`: `compose.rs` is the drawing (layers, the CSS matrix
as the renderer's, logical↔window mapping) and is where the offscreen pixel tests
live; `dmabuf_import.rs` is the import and the readback; `scale.rs` is the output
scale arithmetic; `outbound.rs` is the copy path's queueing policy.

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

### Phase 1 — one window composites natively — one item left

Everything is built and works on hardware. What remains is the measurement it was
all for, and it is one command on a machine with a display:

```sh
nix run 'github:cprussin/domicile#measure'
```

It runs each path in turn on the same client at the same size, types a fixed
number of keystrokes into it, and prints what each reported. The keystrokes are
injected over the chrome socket rather than typed, so the two runs are comparable
and neither is hand-timed; they are spaced, because both measurements take the
oldest unanswered keystroke and a burst would be counted once.

Parity means `readback_ms` and `ipc_ms` are *gone*, not smaller. Until that
number exists nothing downstream is justified — if it is not there, the shader
work below is premature.

### Phase 2 — the effects that make an app a CSS element

- rounded corners, opacity and shadow in the compositor's shader
- the rotated + rounded + shadowed window that was the original success criterion,
  at native cost
- chrome above *and* below as two engine layers (only above is free today)
- per-window fallback to the copy path when a computed style needs an effect the
  shader cannot do — this is what makes the native path safe to leave on: correct
  always, fast almost always

### Phase 3 — own the display

DRM/KMS backend and direct scanout for a fullscreen app. Multi-output, damage
tracking, clipboard/data-device, touch and a security review all live here too.

### Known gaps in what is built

- **A client that draws its own cursor into a surface gets a plain arrow.**
  Compositing that surface is the same work as compositing any other.
- **The chrome is not told when a click focuses a window**, so a chrome that
  displays focus can go stale.
- **One output.** The scene has a single `surface_to_output`; the desktop's size
  follows Domicile's window, which is all a nested compositor can do.
- **Fractional scaling.** Non-integer ratios round *up* to the next integer scale:
  a client drawing more pixels than the display has is downscaled and stays sharp,
  while one drawing fewer is stretched. Matching a ratio exactly needs
  `wp_fractional_scale_v1`, which is a separate protocol and not done.
- **The full transform chain.** An *ancestor* element that rotates or skews is
  missed on the copy path — `getBoundingClientRect` gives only an axis-aligned
  box. The native path does not have this problem, because the matrix the chrome
  reports is the one the compositor draws through.
- **Hot-swapping the chrome package** needs the daemon to own that process, which
  it does not; the config watcher half is wired.

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
