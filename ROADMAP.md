# Loom roadmap & handoff

Loom is a Wayland compositor whose **renderer is a web engine**: all chrome is
web content, and app windows composite inside the engine as texture-backed DOM
elements so `<app>` gets full CSS. Read `docs/ARCHITECTURE.md` (the why) and
`docs/CEF-SPIKE.md` (the long-term zero-copy engine plan) first.

Built test-first, from the pure-logic core outward to the hardware/engine glue.

---

## Handoff: start here (context for the next agent)

### Current state (working prototype)
A runnable end-to-end prototype exists and is verified headlessly:
real Wayland client → `wc-compositor` (Smithay, headless) → shared `Host` brain
→ Electron chrome, which mounts a styled `<loom-app>`, **draws the client's live
pixels** (shm path), and **forwards keyboard + pointer input back to the client**.
`kitty` (Alt+Enter) and a Google `<webview>` (Alt+Shift+Enter) launch from the
demo shell. **72 Rust tests (68 core + 4 in wc-compositor) + 42 JS tests, clippy
clean.** ~14 commits, each a green TDD increment.

### How to run / test
```sh
nix develop                     # core shell: rust + node
cargo test                      # 68 core Rust tests
npm test                        # 42 JS tests (vitest + jsdom)

nix develop .#full              # adds wayland, mesa, weston, electron, xvfb, kitty
cargo build -p wc-compositor    # the Smithay server (EXCLUDED from default build)
cargo test -p wc-compositor     # 4 unit tests (BGRA->RGBA conversion)

# End-to-end, headless (no display needed; use these to verify changes):
nix develop .#full -c ./scripts/smoke-compositor.sh   # a real client binds our globals
nix develop .#full -c ./scripts/e2e-chrome.sh         # client -> host -> mock chrome (app_appeared)
nix develop .#full -c ./scripts/e2e-electron.sh       # real Electron renderer under Xvfb; pixels flow
nix develop .#full -c ./scripts/e2e-spawn.sh          # a chrome `spawn` message launches a client
nix develop .#full -c ./scripts/e2e-input.sh          # keyboard + pointer reach a client (WAYLAND_DEBUG)

# Full visible prototype (needs a real display — run on the user's machine):
nix develop .#full -c ./scripts/run-prototype.sh
#   then, in another terminal on Loom's display:
#   XDG_RUNTIME_DIR=/tmp/loom-rt WAYLAND_DISPLAY=wayland-1 weston-flower
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
  is too long — use a **short** `XDG_RUNTIME_DIR` like `/tmp/loom-rt` for anything
  that binds a wayland/chrome socket. (`wayland-1` squeaked under; `loom-chrome.sock`
  did not — this cost real debugging time.)
- **`wc-compositor` is excluded from `default-members`** (it pulls Smithay +
  native libs). Plain `cargo test`/`cargo build` in the core shell skip it; build
  it explicitly in `.#full`.
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
- **`kitty`** is GPU/dmabuf: maps + input works, but pixels need the dmabuf path
  (we only import `wl_shm` today). The user reported kitty *does* show pixels for
  them (possibly an shm fallback), but don't count on GPU clients rendering yet.

### Repo layout
| Path | What | Build |
|---|---|---|
| `crates/wc-config` | config schema/parse/validate, hot-reload (keep last-good), chrome-package resolution | core |
| `crates/wc-scene` | affine transforms + inverse, hit-testing, input routing, z-order (pure math) | core |
| `crates/wc-protocol` | host↔chrome wire messages (JSON), versioning | core |
| `crates/wc-host` | orchestrator `Host` brain + `ipc` (handshake, `handle_chrome_line`/`apply_chrome_message`) | core |
| `crates/loom` | host daemon / control plane (config → serve chrome protocol) | core |
| `crates/wc-bridge` | AppTextureBridge bookkeeping (app → external-image id + latest dmabuf) — pure, unused by the prototype yet | core |
| `crates/wc-compositor` | **the running compositor**: Smithay server + chrome socket + shm pixel capture + input injection | `.#full` |
| `chrome-sdk` | `<loom-app>`/`<loom-webview>` elements, `BridgeClient`, matrix/frame/input helpers | node |
| `shells/simple` | reference chrome: bar + stage; `ShellController`; Electron host (`electron-main.cjs`/`preload.cjs`) | node |
| `scripts/` | e2e + smoke + prototype launcher | — |

JS note: Electron main/preload are **CommonJS `.cjs`** (root `package.json` has
`type: module`); the renderer is ESM and resolves `@loom/chrome-sdk` via an
**import map** in `index.html` (no bundler). Custom element tag names are
hyphenated (`loom-app`/`loom-webview`); bare `<app>`/`<webview>` aliasing is a TODO.

### How input & pixels actually flow (mental model)
- **Pixels**: `wc-compositor` `commit()` → read shm buffer → `bgra_to_rgba` →
  base64 → `HostMessage::AppFrame` broadcast → chrome-sdk `<loom-app>.drawFrame`
  → `<canvas>`. Throttled ~30fps; frame callbacks answered so clients animate.
- **Input**: real events hit the Electron window → `<loom-app>` / document
  listeners in chrome-sdk → `ChromeMessage::{PointerMotion,PointerButton,Key,…}`
  over the socket → compositor intercepts (before the pure brain) → `InputEvent`
  over calloop channel → `LoomCompositor::handle_input` → seat inject. Click
  focuses an app (`FocusApp` → `keyboard.set_focus`); click on chrome unfocuses.

---

## Phases

### Phase 0 — Foundation ✅
### Phase 1 — Pure-logic core (TDD) ✅
`wc-config`, `wc-scene`, `wc-protocol` — all green.

### Phase 3 — Wayland host ✅ (prototype complete)
`Host` brain, IPC seam, `loom` daemon, `wc-compositor` (compositor + shm +
xdg-shell + seat + output), unified process, real pixels (shm), and keyboard +
pointer input injection — all done and verified headlessly.

### Phase 4 — Chrome SDK + simple shell ✅ (prototype complete)
`chrome-sdk`, `shells/simple`, Electron host, keybindings (Alt+Enter → kitty,
Alt+Shift+Enter → Google webview).

### Phase 2 / Next work — prioritized for the next agent
1. **Zero-copy dmabuf import (BIGGEST)** — so GPU clients (kitty, most modern
   apps) actually render. Add `zwp_linux_dmabuf`; to get pixels to the chrome
   you either import the dmabuf into a GL/EGL context in the compositor and read
   it (heavy) or hand the fd to the renderer (WebGL/WebGPU import). This is also
   the on-ramp to the CEF external-texture path — see `docs/CEF-SPIKE.md`.
2. **Cursor rendering** — clients call `set_cursor`; `SeatHandler::cursor_image`
   is currently a no-op, so no cursor shows over apps. The chrome should render
   the client's requested cursor (or a CSS cursor) over the `<app>`.
3. **Resize / configure** — the compositor only sends a fixed initial configure.
   When the chrome resizes an `<app>`, send an `xdg_toplevel` configure with the
   new size so the client re-renders. (`HostMessage::AppResized` exists but isn't
   wired from real size changes; and the shell doesn't report app resizes yet.)
4. **Pointer mapping vs CSS transforms** — chrome-sdk maps element-box →
   surface-local using `getBoundingClientRect` (axis-aligned). The demo `.app`
   has `transform: rotate(-1.2deg)`, which skews pointer coords. Either drop the
   demo rotation or do a proper inverse-transform in the chrome (the Rust side
   `wc-scene` has the math but the chrome currently maps on its own).
5. **Config hot-reload into the live process** — `wc-config` has the watcher
   (`watch()`), not yet wired into the running `loom`/`wc-compositor` to hot-swap
   config/shell without restart.
6. **Multi-app focus / z-order / stacking** — `wc-scene` models it; the
   compositor currently targets by `app_id` and keyboard focus is last-clicked.
7. **Keymap + axis coverage** — `chrome-sdk/src/input.js` covers common keys;
   extend (numpad, media, intl). Axis is wired (source Wheel); may need v120.
8. **Bare `<app>`/`<webview>` tag aliasing**, **hot-swap shells via config**.

### Phase 5 — Hardening (later)
DRM/KMS backend for real hardware, multi-output, HiDPI, damage tracking,
security/sandbox review, clipboard/data-device, touch.

---

## Collaboration notes
The user "vibecodes": proceed autonomously, follow your own recommendations,
don't stop to ask unless genuinely blocked on their taste/hardware. Keep strict
TDD. Commit freely. (Also captured in the memory files loaded via `MEMORY.md`.)
