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
pixels** (shm path), and **forwards keyboard + pointer input back to the client**.
`kitty` (Alt+Enter) and a Google `<webview>` (Alt+Shift+Enter) launch from the
demo shell. **84 Rust tests (78 core + 6 in domicile-compositor) + 95 JS tests, clippy
clean.**

Since the first prototype, most of Phase 2 has landed (see the phase list below):
a client's requested **cursor** reaches the chrome as a CSS keyword, the chrome's
element size **configures** the client and the client's own size flows back,
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
- **`kitty`** is GPU/dmabuf: maps + input works, but pixels need the dmabuf path
  (we only import `wl_shm` today). The user reported kitty *does* show pixels for
  them (possibly an shm fallback), but don't count on GPU clients rendering yet.

### Repo layout
| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema/parse/validate, hot-reload (keep last-good), chrome-package resolution | core |
| `packages/domicile-scene` | affine transforms + inverse, hit-testing, input routing, z-order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages (JSON), versioning | core |
| `packages/domicile-host` | orchestrator `Host` brain + `ipc` (handshake, `handle_chrome_line`/`apply_chrome_message`) | core |
| `packages/domicile` | host daemon / control plane (config → serve chrome protocol) | core |
| `packages/domicile-bridge` | AppTextureBridge bookkeeping (app → external-image id + latest dmabuf) — pure, unused by the prototype yet | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server + chrome socket + shm pixel capture + input injection | `.#full` |
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
- **Pixels**: `domicile-compositor` `commit()` → read shm buffer → `bgra_to_rgba` →
  base64 → `HostMessage::AppFrame` broadcast → chrome-sdk `<domicile-app>.drawFrame`
  → `<canvas>`. Throttled ~30fps; frame callbacks answered so clients animate.
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
`Host` brain, IPC seam, `domicile` daemon, `domicile-compositor` (compositor + shm +
xdg-shell + seat + output), unified process, real pixels (shm), and keyboard +
pointer input injection — all done and verified headlessly.

### Phase 4 — Chrome SDK + simple shell ✅ (prototype complete)
`packages/chrome-sdk`, `apps/shell`, Electron host, keybindings (Alt+Enter → kitty,
Alt+Shift+Enter → Google webview).

### Phase 2 — mostly done
Numbered as the original list was, so the items map one-to-one; item 1 is the
one still open and leads the next-work list below.

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

1. **Zero-copy dmabuf import (BIGGEST, still open)** — so GPU clients (kitty,
   most modern apps) actually render. Add `zwp_linux_dmabuf`; to get pixels to
   the chrome you either import the dmabuf into a GL/EGL context in the
   compositor and read it (heavy) or hand the fd to the renderer (WebGL/WebGPU
   import). This is also the on-ramp to the CEF external-texture path — see
   `docs/architecture/CEF-SPIKE.md`. It needs real GPU hardware, so it could not
   be done or verified in the headless container the rest of this work was built
   in.
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
