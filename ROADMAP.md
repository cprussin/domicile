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
back to the client**. `kitty` (Alt+Enter) and a Google `<webview>` (Alt+Shift+Enter)
launch from the demo shell. **89 Rust tests (78 core + 11 in domicile-compositor) +
95 JS tests, clippy clean.**

Since the first prototype, most of Phase 2 has landed (see the phase list below):
GPU clients get a **`zwp_linux_dmabuf_v1`** global and their buffers are imported
through an offscreen GLES context, a client's requested **cursor** reaches the
chrome as a CSS keyword, the chrome's element size **configures** the client and
the client's own size flows back,
pointer coordinates are **inverse-transformed** so a rotated `<app>` maps
correctly, the keymap and scroll axis are filled out, an app **raises** when
focused, `<app>` works as an alias for `<domicile-app>`, and the daemon
**hot-reloads** its config. The wire protocol is at `PROTOCOL_VERSION = 2`.

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
| `apps/shell` | reference chrome: bar + stage; `ShellController`; Electron host (`src/main.ts`/`src/preload.ts`) | bun |
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
  once the readback goes away.
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
`packages/chrome-sdk`, `apps/shell`, Electron host, keybindings (Alt+Enter → kitty,
Alt+Shift+Enter → Google webview).

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

---

## Collaboration notes
The user "vibecodes": proceed autonomously, follow your own recommendations,
don't stop to ask unless genuinely blocked on their taste/hardware. Keep strict
TDD. Commit freely. (Also captured in the memory files loaded via `MEMORY.md`.)
