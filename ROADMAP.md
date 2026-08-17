# Domicile roadmap & handoff

Domicile is a Wayland compositor whose **renderer is a web engine**: all chrome is
web content, and app windows composite inside the engine as texture-backed DOM
elements so `<app>` gets full CSS. Read `docs/architecture/ARCHITECTURE.md` (the why) and
`docs/architecture/CEF-SPIKE.md` (the long-term zero-copy engine plan) first.

Built test-first, from the pure-logic core outward to the hardware/engine glue.

---

## Handoff: start here (context for the next agent)

### Current state (working prototype)
A runnable end-to-end prototype exists and is verified headlessly:
real Wayland client → `domicile-compositor` (Smithay, headless) → shared `Host` brain
→ Electron chrome, which mounts a styled `<domicile-app>`, **draws the client's live
pixels** (both the shm and the dmabuf path), and **forwards keyboard + pointer input
back to the client**. The demo shell tabs its windows — one on the stage at a
time — and launches them from its bar: `kitty` (or Alt+Enter) and a browser
window with an address bar (or Alt+Shift+Enter).
**89 Rust tests (78 core + 11 in domicile-compositor) +
126 JS tests, clippy clean.**

Since the first prototype, most of Phase 2 has landed (see the phase list below):
GPU clients get a **`zwp_linux_dmabuf_v1`** global and their buffers are imported
through an offscreen GLES context, a client's requested **cursor** reaches the
chrome as a CSS keyword, the chrome's element size **configures** the client and
the client's own size flows back,
pointer coordinates are **inverse-transformed** so a rotated `<app>` maps
correctly, the keymap and scroll axis are filled out, an app **raises** when
focused, `<app>` works as an alias for `<domicile-app>`, and the daemon
**hot-reloads** its config. The **keymap is configurable** — `[input.keyboard]`
takes sway's `xkb_rules` / `xkb_model` / `xkb_layout` / `xkb_variant` /
`xkb_options`, defaulting to Programmer's Dvorak with Caps Lock and Escape
swapped; the compositor compiles it into the seat at boot (a config edit needs a
restart to take). The wire protocol is at `PROTOCOL_VERSION = 3`.

### How to run / test
```sh
nix develop                     # core shell: rust + node
cargo test                      # core Rust tests
bun run turbo test              # TypeScript: lint, types, unit tests, shell build

nix develop .#full              # adds wayland, mesa, weston, electron, xvfb, kitty
cargo build -p domicile-compositor    # the Smithay server (EXCLUDED from default build)
cargo test -p domicile-compositor     # 4 unit tests (BGRA->RGBA conversion)

# End-to-end, headless (no display needed; use these to verify changes):
nix develop .#full -c ./scripts/smoke-compositor.sh   # a real client binds our globals
nix develop .#full -c ./scripts/e2e-chrome.sh         # client -> host -> mock chrome (app_appeared)
nix develop .#full -c ./scripts/e2e-electron.sh       # real Electron renderer under Xvfb; pixels flow
nix develop .#full -c ./scripts/e2e-spawn.sh          # a chrome `spawn` message launches a client
nix develop .#full -c ./scripts/e2e-input.sh          # keyboard + pointer reach a client, and its cursor request reaches the chrome
nix develop .#full -c ./scripts/e2e-dmabuf.sh         # the dmabuf global is advertised; with a GPU, a real GPU client's frames arrive
nix develop .#full -c ./scripts/e2e-slow-chrome.sh    # a chrome that stops reading does not freeze the compositor

# Full visible prototype (needs a real display — run on the user's machine):
nix develop .#full -c ./scripts/run-prototype.sh
#   then, in another terminal on Domicile's display:
#   XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

### Environment gotchas (these will bite you — read them)
- **Shell is bash**, despite any env note saying nushell.
- **Commits**: gpg signing fails here. Commit with
  `git -c commit.gpgsign=false -c user.name="Claude" -c user.email="noreply@anthropic.com" commit …`
  and end the message with the `Co-Authored-By: Claude …` trailer. Commit freely
  (the user said "you own it").
- **Nix + git**: `nix develop` only sees **git-tracked** files. A brand-new
  untracked file makes the flake error with "not tracked by Git" — `git add` it
  first (staging is enough; a dirty tree is fine, just warns).
- **Unix socket path length ≤ ~108 chars (SUN_LEN)**. The session scratchpad path
  is too long — use a **short** `XDG_RUNTIME_DIR` like `/tmp/domicile-rt` for anything
  that binds a wayland/chrome socket. (`wayland-1` squeaked under; `domicile-chrome.sock`
  did not — this cost real debugging time.)
- **`nix run github:...?ref=<branch>` caches the branch for an hour.** Nix
  re-resolves a mutable ref only after `tarball-ttl`, so a `nix run` right after
  a force-push re-runs the *old* revision — with a stale staged copy and its
  already-built binary, which reads exactly like "my fix did nothing". Pass
  `--refresh` whenever the branch is moving.
- **libEGL is `dlopen`ed, not linked.** The dmabuf import loads `libEGL.so.1`
  at runtime, and `mkShell` only wires *build-time* linkage — a package in
  `packages` is not on the loader path. The `.#full` shell therefore sets
  `LD_LIBRARY_PATH` (`/run/opengl-driver/lib` first, so NixOS's EGL vendor
  matches the running kernel driver). Without it the compositor logs
  `no EGL renderer: serving wl_shm clients only` and never advertises the
  dmabuf global.
- **`WAYLAND_DEBUG=1` output is ANSI-coloured**, even into a file, and the
  escapes land *between* the interface name and the event — `wl_surface` ESC
  `#12` ESC `.enter`. Every `scripts/*.sh` grep over a client log reads plain
  text, so a coloured log matches nothing and the check passes nothing: it
  reports the compositor's *own* bug rather than finding one. The scripts now
  set `NO_COLOR=1` alongside `WAYLAND_DEBUG=1`; keep doing that. (The `.#full`
  shell sets `FORCE_COLOR=1` for turbo/biome, which is what libwayland picks
  up — so this bites in the dev shell and not necessarily outside it.)
- **`domicile-compositor` is excluded from `default-members`** (it pulls Smithay +
  native libs). Plain `cargo test`/`cargo build` in the core shell skip it; build
  it explicitly in `.#full`.
- **Verifying without nix**: the headless scripts need `libxkbcommon-dev` (to
  link `domicile-compositor`), `weston` (demo clients) and `wayland-utils`
  (`wayland-info`). With those, `cargo test -p domicile-compositor` and every
  `scripts/*.sh` except `e2e-electron.sh` run outside the nix shell;
  `e2e-electron.sh` additionally needs `electron` on `PATH`.
- Reference material for Smithay: fetch from `github.com/Smithay/smithay` tag
  **`v0.7.0`** (smallvil + anvil examples, `src/input/*`, `src/wayland/*`). This
  was invaluable for getting the 0.7 API exactly right.

### Smithay 0.7 specifics we learned
- **Keycodes need `+8`** (evdev → xkb): the libinput backend does
  `(key()+8).into()`, so `KeyboardHandle::input` wants X keycodes. The chrome
  sends evdev; the compositor adds 8. (In `handle_input`.)
- **Must flush clients** after dispatch *and* after off-thread input, or clients
  hang. The `Display` lives in `CalloopData` and we `flush_clients()` in the
  `event_loop.run` callback (fires every iteration, including after channel input).
- **Need a `wl_output` global** or many clients won't map a toplevel
  (weston-terminal, kitty wait for it). `weston-flower` / `weston-smoke` /
  `weston-eventdemo` map fine and are good shm test clients.
- Input from the chrome is injected on the **Wayland thread** via a
  `calloop::channel` (seat + surfaces aren't `Send`). Chrome connections run on
  their own threads and push `InputEvent`s onto that channel.

### Client quirks (for testing)
- **`weston-eventdemo` does NOT print pointer events to stdout** (it handles them
  silently — e.g. `set_cursor`). Use `WAYLAND_DEBUG=1` and grep the stderr for
  `wl_pointer#N.button` / `wl_keyboard#N.key` to verify input delivery. This
  wasted time once — `scripts/e2e-input.sh` now uses WAYLAND_DEBUG.
- **`wev` segfaults** on our minimal compositor — don't use it.
- **`nix run` stages the git source, so there is no `node_modules`.** Every
  e2e script drives a bun harness that imports the workspace packages, so
  without `bun install` the harness dies on its first import — and a harness
  that never starts is indistinguishable from a chrome that received nothing.
  The flake's runner installs before running; `e2e-dmabuf.sh` also fails loudly
  when no chrome connects rather than reporting zero frames.
- **Reassembling a frame chunk-by-chunk must not re-join the buffer.** The
  socket reader used to do `buffered + chunk` per chunk, which is quadratic: a
  16MB base64 frame arriving in 64KB pieces took ~12s to reassemble and looked
  like a chrome receiving nothing. `createFrameReader` keeps the tail as pieces
  and joins once a delimiter arrives. Small geometry messages never showed this;
  GPU frames at native resolution did.
- **Never *wait* on a chrome from the Wayland loop either.** Moving the writes
  off that thread is not enough if queueing them can block: a bounded queue with
  a blocking fallback stalls the Wayland thread whenever the chrome is behind,
  which under a steady frame load is always. That thread also injects input, so
  a few hundred milliseconds of waiting is a few hundred milliseconds of frozen
  input — past the 200ms repeat delay, so a key the user tapped starts
  repeating. Frames and lifecycle messages need opposite policies, in
  `outbound.rs`: drop frames past a shallow cap, never drop or wait on messages.
- **The compositor reports its own frame rate.** Every 5s while compositing it
  logs one INFO line, so "is it faster" is a number rather than an impression:

  ```
  frames sent=N dropped=M fps=F mb_per_s=B write_ms=W \
         readback_ms=R readback_worst_ms=RW commit_ms=C idle_ms=I chromes=K
  ```

  It is the only place that sees the whole path, and each field indicts a
  different half of it:
  - `readback_ms` — the GPU copy (`dmabuf_import::read_rgba`). Our own cost, and
    the one the CEF external-texture path deletes outright.
  - `commit_ms` — the whole Wayland-thread commit; `commit_ms - readback_ms` is
    everything around the copy (format conversion, queueing, the release).
  - `idle_ms` — the gap between one commit finishing and the next arriving.
    Large here means the compositor was *waiting*, not working: a slow client,
    or the 33ms throttle holding it back. `idle + commit ≈ 1000/fps` is the
    self-check that the three account for the whole frame.
  - `dropped` climbing while `fps` stays flat means pixels are being produced
    faster than the chrome can take them; a high `write_ms` means the chrome's
    socket is what is backing up.

  - `response_ms` — from injecting a keystroke into a client to that client's
    next commit: the client's own think-and-redraw, isolated. Not ours to fix,
    which is exactly why it has to be separable from what is.
  - `throttled` — commits the ~30fps throttle refused. Each one is a redraw the
    client made and the chrome never saw, so if the client then goes idle the
    screen holds stale pixels until it happens to redraw again.
- **The chrome reports the round trip.** On the same 5s cadence and the same
  stdout, so the two lines can be read against each other:

  ```
  chrome: round trip keys=N rt_ms=R rt_worst_ms=RW \
          frames=F ipc_ms=I ipc_worst_ms=IW draw_ms=D draw_worst_ms=DW
  ```

  `rt_ms` is the number behind "sluggish": everything from pressing a key to
  those pixels being on the canvas, including the client's own redraw, the
  socket, the Electron IPC hop and `putImageData`. It is taken in
  `BridgeClient`, the one place that sees both ends of the loop, and *after*
  the frame handler runs so the canvas draw is inside it. Frames nobody was
  waiting on — a terminal's blinking cursor — are not round trips and are not
  counted; counting them would report the blink interval as input latency. A
  burst is measured from its oldest keystroke, since the felt lag is how long
  the first character waited.

  **Key presses only, never releases** — the same rule in `response_ms`. A
  release changes nothing on screen, so the next frame to arrive is some
  unrelated redraw (that blinking cursor, half a second later), and every press
  is followed by a release: counting them contaminated half of every sample and
  put a fake ~500ms tail on both numbers. This was a real bug in the first cut
  of the instrumentation, and it cost two rounds of blaming the client for it.
  If a latency number grows a tail at suspiciously exactly some client's idle
  redraw period, suspect the measurement before the client.

  `ipc_ms` and `draw_ms` are the two stages inside `rt_ms` that the compositor
  cannot see, so a large total can be attributed rather than merely observed:
  the main-process → renderer hop (where a frame's megabytes are
  structured-cloned across a process boundary) and putting them on the canvas.
  `ipc_ms` is measured in the *preload*, the first code in the renderer process
  to see a message, so none of the page's own work is inside it.

  Together with the compositor's line the whole loop accounts for itself:

  ```
  rt_ms  =  (key delivery)  +  response_ms  +  readback_ms  +  write_ms
            +  ipc_ms  +  draw_ms
  ```

  Every term but the first is measured, so **key delivery is what is left
  over** — and it is entirely ours. Measured on an AMD 890M with kitty at
  ~1500x1000: `rt_ms≈100`, `ipc_ms≈19`, `draw_ms≈1`, compositor ≈11. The
  canvas is free; the Electron IPC hop is ~19% and is where a frame's
  megabytes are copied between processes.
- **A renderer has no stdout.** Its `console` goes to devtools, which nobody has
  open while driving the prototype from a terminal, so the shell's preload
  exposes `window.domicileDiagnostics.report(line)` and the Electron main
  process prints it. Deliberately not on `domicileTransport`: that object is the
  host protocol, whose shape the SDK's `Transport` type fixes.
- **Throughput and latency are different questions, and only one of them was
  ever measured.** A run showing `fps=2` on an idle kitty is not slow — an idle
  terminal redraws once per cursor blink (~500ms), which is exactly what
  `idle_ms` clusters at. A keystroke taking 300ms to appear looks identical in
  that line. Do not read a low `fps` as a bottleneck without checking whether
  anything was asking the client to draw.
- **Pixels are bytes on the wire, so the stream is not text.** `app_frame`
  carries a byte count and the pixels follow the header line raw. A reader that
  scans for newlines inside a payload will cut a frame in half — a pixel is as
  likely to be `0x0a` as anything else — so the host→chrome direction is read by
  `host-stream.ts` over bytes, by count. Base64 was the single most expensive
  step in the frame path: ~9ms to encode, ~11ms to escape into JSON and ~31ms to
  `atob` back, the last on the renderer thread that also handles the keyboard.
- **Run the prototype in release.** The frame path is where an unoptimised
  build shows: base64 + JSON for one 1494x994 frame costs 264ms in debug against
  20ms in release, a 4fps ceiling against 50fps. `run-prototype.sh` builds
  `--release`; the e2e scripts stay on debug, where only correctness matters.
- **Two input bugs hid behind the blank window.** Nobody typed into an app
  until GPU clients rendered, so both only surfaced then. (1) The chrome
  forwarded the browser's auto-repeat `keydown`s as fresh Wayland presses; a
  client synthesises repeat itself from `wl_keyboard.repeat_info`, so it had two
  repeat sources and drew the same character over and over. (2)
  `decodeBase64ToBytes` used `Uint8Array.from(binary, cb)` — a callback per
  byte, ~350ms for a 6MB frame on the renderer's only thread, which is also the
  thread that forwards keystrokes. An indexed loop is ~30ms.
- **Never write to a chrome from the Wayland loop.** Frames are big — a
  1753x1753 window is 12MB read back and 16MB of base64 — so a chrome that reads
  slowly fills the socket buffer within a frame or two. A blocking `write_all`
  there stops frame callbacks and freezes *every* client, which reads as "the
  GPU path imported one frame and died". Encoding and writing happen on a writer
  thread; frames are dropped when it falls behind, because the next frame
  supersedes them. `scripts/e2e-slow-chrome.sh` holds the line.
- **A GPU client is slow between mapping and drawing.** kitty maps its window
  almost at once and reaches its first frame seconds later (font cache, GPU
  init, shader compile). Anything that samples "did a frame arrive" off the map
  will read zero and blame the compositor. `e2e-dmabuf.sh` waits for the
  compositor's own `broadcast app frame` line before attaching the chrome, since
  the harness only listens for a few seconds.
- **Send `wl_surface.enter`.** A toolkit that scales its content asks which
  output a surface is on before it draws anything — GLFW (and so kitty) blocks
  on exactly this, mapping a window that stays blank. `Output::enter` on the one
  virtual output is the whole fix; `e2e-chrome.sh` asserts it.
- **A v3 dmabuf global is not enough for Mesa.** The format list says *what*
  a client may allocate, never *which GPU* to allocate it on. Mesa learns that
  from `wl_drm` (which Domicile does not advertise) or from v4 feedback's
  `main_device`, so a v3-only global leaves it unable to pick a device. The
  compositor now builds feedback from the `dev_t` of the EGL device's render
  node; a software rasteriser has no node, so it still falls back to v3.
- **Buffers must be released.** A client may not touch a buffer again until
  the compositor sends `wl_buffer.release`, and Smithay only releases the
  *previous* buffer when the next one is committed — which is the buffer the
  client cannot draw. The compositor now takes the buffer out of the surface
  state and releases it once the pixels are out of it. `e2e-chrome.sh` asserts
  the release, since nothing else makes it visible.
- **`weston-flower` is not an animating client here.** Under real weston
  (headless) it commits twice and stops, same as under Domicile — don't read a
  frozen flower as a compositor bug. `weston-simple-shm` animates properly and
  is the better shm client for frame-rate work.
- **`kitty`** is GPU/dmabuf and goes through the dmabuf import path, verified on
  an AMD iGPU. Note it takes ~7s from mapping its window to its first frame
  (font cache, GPU init), and it sizes itself to the output unless the chrome
  configures it — 1494x994 is ~6MB a frame. `scripts/e2e-dmabuf.sh` is the check;
  in the container it only ever reaches llvmpipe (software EGL), where no client
  can allocate a dmabuf, so it stops after asserting the global.
- **GPU test clients**: `weston-simple-dmabuf-egl` is the smallest one, but
  nixpkgs builds weston with `simple-clients` off, so it is absent from the full
  shell. `scripts/e2e-dmabuf.sh` prefers it when present and falls back to
  `kitty`, which the shell always has.

### Repo layout
| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema/parse/validate, hot-reload (keep last-good), chrome-package resolution | core |
| `packages/domicile-scene` | affine transforms + inverse, hit-testing, input routing, z-order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages (JSON), versioning | core |
| `packages/domicile-host` | orchestrator `Host` brain + `ipc` (handshake, `handle_chrome_line`/`apply_chrome_message`) | core |
| `packages/domicile` | host daemon / control plane (config → serve chrome protocol) | core |
| `packages/domicile-bridge` | AppTextureBridge bookkeeping (app → external-image id + latest dmabuf) — pure; the compositor now keeps it current | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server + chrome socket + shm/dmabuf pixel capture + input injection | `.#full` |
| `packages/chrome-sdk` | `<domicile-app>`/`<domicile-webview>` elements, `BridgeClient`, matrix/frame/input/protocol helpers | bun |
| `packages/test-support` | shared bun test setup (happy-dom + jest-dom matchers) | bun |
| `packages/e2e-harness` | headless chrome stand-ins for the `scripts/e2e-*.sh` checks | bun |
| `apps/shell` | reference chrome: bar + tabs + stage; `ShellController`, `TabBar`, browser windows; Electron host (`src/main.ts`/`src/preload.ts`) | bun |
| `scripts/` | e2e + smoke + prototype launcher | — |

TS note: the chrome is TypeScript built by Vite — the Electron main process to
`.vite/build/main.js` (ESM) and the preload to `.vite/build/preload.cjs` (CJS,
as Electron's isolated world requires). The renderer bundle resolves
`@domicile/chrome-sdk` as an
**import map** in `index.html` (no bundler). Custom element tag names are
hyphenated (`domicile-app`/`domicile-webview`); bare `<app>`/`<webview>` aliasing is a TODO.

### How input & pixels actually flow (mental model)
- **Pixels**: `domicile-compositor` `commit()` → either read the shm buffer
  (`bgra_to_rgba`) or import the client's dmabuf into an offscreen GLES context
  and read it back (`dmabuf_import`) → base64 → `HostMessage::AppFrame` broadcast
  → chrome-sdk `<domicile-app>.drawFrame` → `<canvas>`. Throttled ~30fps; frame
  callbacks answered so clients animate. Each dmabuf is also recorded in
  `BridgeRegistry`, which is what the engine will bind as an external texture
  once the readback goes away. Pixels leave the compositor as **raw bytes after
  the `app_frame` header line**, not base64 inside it — see the note below.
- **Input**: real events hit the Electron window → `<domicile-app>` / document
  listeners in chrome-sdk → `ChromeMessage::{PointerMotion,PointerButton,Key,…}`
  over the socket → compositor intercepts (before the pure brain) → `InputEvent`
  over calloop channel → `DomicileCompositor::handle_input` → seat inject. Click
  focuses an app (`FocusApp` → `keyboard.set_focus`); click on chrome unfocuses.

---

## Phases

### Phase 0 — Foundation ✅
### Phase 1 — Pure-logic core (TDD) ✅
`domicile-config`, `domicile-scene`, `domicile-protocol` — all green.

### Phase 3 — Wayland host ✅ (prototype complete)
`Host` brain, IPC seam, `domicile` daemon, `domicile-compositor` (compositor + shm
+ dmabuf + xdg-shell + seat + output), unified process, real pixels, and keyboard +
pointer input injection — all done and verified headlessly (the dmabuf import
apart; see item 1 below).

### Phase 4 — Chrome SDK + simple shell ✅ (prototype complete)
`packages/chrome-sdk`, `apps/shell`, Electron host, a tab bar over the windows
(apps and browser windows alike, one shown at a time), bar launchers and
keybindings (Alt+Enter → kitty, Alt+Shift+Enter → a browser window), and an
address bar with back / forward / stop / reload on browser windows.

### Phase 2 — mostly done
Numbered as the original list was, so the items map one-to-one; item 1 is the
one with work left in it and leads the next-work list below.

2. **Cursor rendering** ✅ — the compositor advertises `wp_cursor_shape_v1` and
   forwards `SeatHandler::cursor_image` to the chrome as
   `HostMessage::AppCursor`, carrying the CSS `cursor` keyword the chrome
   assigns to the app's element (`domicile_protocol::CursorShape`). Proven
   end-to-end by `scripts/e2e-input.sh`. *Remaining:* a client that draws its
   own cursor **surface** gets `default` — mirroring those pixels is texture-bridge
   work, so it belongs with item 1.
3. **Resize / configure** ✅ — `<domicile-app>` watches its own box
   (`ResizeObserver`) and sends `resize_app`; the compositor turns that into an
   `xdg_toplevel` configure. The reverse is wired too: a client committing a
   buffer of a new size drives `Host::app_resized`, so `app_resized` now reaches
   the chrome (visible in `scripts/e2e-chrome.sh` output).
4. **Pointer mapping vs CSS transforms** ✅ — the chrome recovers the exact
   element→screen affine (`element-transform.ts`: the element's own transform
   about its `transform-origin`, anchored by its bounding box) and inverts it
   (`surface-coordinates.ts`). The demo's `rotate(-1.2deg)` no longer skews
   pointer coordinates. *Known limit:* an **ancestor** that rotates or skews is
   still missed — `getBoundingClientRect` gives only an axis-aligned box, so
   there is nothing left to recover it from. The engine integration, which knows
   each layer's transform outright, is what closes that.
5. **Config hot-reload into the live process** ✅ (the wiring) — `domicile` now
   watches its config file and keeps the last known-good config live
   (`domicile::config_reload`), logging what each edit changed. *Remaining:*
   actually hot-*swapping* the shell needs the daemon to own the shell process,
   which it does not yet — today `scripts/run-prototype.sh` launches Electron.
6. **Multi-app focus / z-order / stacking** ✅ — `Scene::upsert` keeps a
   re-placed app's position in the stack (the chrome re-places on every resize,
   which used to reshuffle it), and `Scene::raise` moves an app to the top of
   its z-index tier; `FocusApp` raises as well as focuses, so clicking the lower
   of two overlapping apps gives it both keyboard and pointer.
7. **Keymap + axis coverage** ✅ — numpad, media/browser, international and IME
   keys, F13–F24 and the system keys. Scroll normalises through wheel detents
   (`wheel-axis.ts`), so line- and page-mode wheels convert correctly, and
   `wl_pointer.axis_value120` is populated alongside the continuous axis.
8. **Bare `<app>` tag aliasing** ✅ — `aliasTag` upgrades `<app>` elements (and
   ones added later) to the registered `<domicile-app>`; the shell installs it in
   `renderer.ts`. `<webview>` deliberately keeps its long name: Electron owns
   that tag and `<domicile-webview>` renders one internally, so aliasing it
   would recurse. That one waits for the engine.

### Phase 2 / Next work — prioritized for the next agent

1. **Zero-copy dmabuf import** ✅ — the *import* half is done and **verified on
   real hardware** (AMD Radeon 890M / radeonsi): kitty allocates GPU buffers,
   `domicile-compositor` imports them and its frames reach the chrome.
   It advertises `zwp_linux_dmabuf_v1` with feedback naming the render node —
   without which Mesa cannot pick a device and never allocates — offering the
   formats an offscreen GLES renderer can take (`dmabuf_import.rs`), imports each
   committed buffer, and records it in `BridgeRegistry` against the app's stable
   external-image id. *Remaining:* the frame still reaches the chrome as
   `AppFrame` pixels, because a `<canvas>` in Electron has no way to take the fd.
   Deleting that readback is the CEF external-texture work in
   `docs/architecture/CEF-SPIKE.md` — the descriptor it needs is already live.
2. **Hot-swap shells via config** — the watcher is wired (item 5 above); the
   missing half is the daemon owning the shell process so a `shell.package`
   change can restart it.
3. **Client cursor surfaces** — mirror the pixels of a client-drawn cursor
   rather than falling back to `default`. Rides on item 1.
4. **Full transform chain in the chrome** — see the known limit under item 4
   above.

### Phase 5 — Hardening (later)
DRM/KMS backend for real hardware, multi-output, HiDPI, damage tracking,
security/sandbox review, clipboard/data-device, touch.

**HiDPI is the one users see first.** `devicePixelRatio`, `set_buffer_scale` and
the output scale appear nowhere yet: the chrome measures an `<app>` in CSS
pixels, `resize_app` sends those, the compositor advertises no output scale, so
a client renders one device pixel per CSS pixel and the canvas is then stretched
over the display's real pixels. Text in a client looks soft on any display that
is not 1x. The fix is a chain — the chrome reports its ratio, the compositor
advertises it as the `wl_output` scale so clients render at that scale *and*
size their UI to match, the compositor honours `set_buffer_scale` when reporting
content size, and the canvas backing store becomes the buffer size while its CSS
size stays logical. Non-integer ratios additionally need
`wp_fractional_scale_v1`.

Note it costs pixels squared: at 2x a 1494x994 frame goes from 5.9MB to 23.8MB,
quadrupling the readback, the socket, the IPC hop and `putImageData`. On the
copy path that is likely unaffordable — which is what the frame report above is
for. It is free on the CEF external-texture path, which is the argument for
doing that first.

---

## Collaboration notes
The user "vibecodes": proceed autonomously, follow your own recommendations,
don't stop to ask unless genuinely blocked on their taste/hardware. Keep strict
TDD. Commit freely. (Also captured in the memory files loaded via `MEMORY.md`.)
