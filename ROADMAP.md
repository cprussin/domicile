# Domicile roadmap

Domicile is a Wayland compositor whose **chrome is a web page**: panels,
launchers and window furniture are web content with full CSS, and an app's
window is a real element in it. It runs on a forked Chromium where `<app>` is a
`cc::SurfaceLayer` embedding a viz surface the compositor submits to — the
mechanism an out-of-process `<iframe>` and a hardware-decoded `<video>` already
use — so CSS applies to a window structurally rather than being reimplemented
against it.

| Read this | For |
|---|---|
| `docs/architecture/ARCHITECTURE.md` | why any of this |
| `docs/architecture/ENGINE-FORK.md` | the fork: the design, the series, what is measured |
| `docs/architecture/WINDOW-COMPOSITING.md` | how a window reaches native cost |
| `docs/WRITING-A-SHELL.md` | the shell author's view |
| `AGENTS.md` | how to work in this repository |

Built test-first, from the pure-logic core outward to the hardware glue.

---

## Where it stands

`domicile-compositor` is the Wayland server — Smithay, the globals, the seat,
the surfaces, the dmabuf import — and it does not draw. Each client's buffer is
submitted to the engine as a viz surface, and the page embeds that surface in
its `<app>` element, so nothing is copied by the CPU and the browser's own
display compositor is what reaches the screen.

`domicile` is the entry point: `domicile ./my-desktop/dist` starts the bridge,
the engine and the compositor, in the one order they can start in. It builds
nothing and wraps nothing — the three components ship beside it, the way a
multi-binary program like postfix does, and it finds them from its own path.

The wire protocol is at `PROTOCOL_VERSION = 1`.

### What is proven, and by what

| Claim | Evidence |
|---|---|
| A window composites at native cost | A submitted frame reaches the display compositor's output in one display frame, indistinguishable from the probe's own floor. `ENGINE-FORK.md`, *What it costs* |
| CSS is structural, not reimplemented | Seven properties measured on a GPU — `z-index` against ordinary DOM, `transform`, `border-radius`, `opacity`, `filter: blur()`, `mix-blend-mode`, resize — every one bit-exact against an ordinary element beside it. `ENGINE-FORK.md`, *What CSS does to an `<app>`* |
| `<app>` and `<webview>` are elements the fork defines | Patch 0007. `document.createElement("app").constructor.name` is `HTMLAppElement`; `app-id` reflects both ways |
| A client's dmabuf imports on AMD | Patch 0005, confirmed on a Radeon 890M on 2026-09-08: kitty survives being floated and resized, on the DCC modifier that used to be refused, with no `gbm_bo_import` failure in the run |
| The desktop a user runs contains all of it | `packages/domicile-engine/engine-release.nix` pins the published engine; `nix run github:cprussin/domicile#manganese` runs it |

---

## What we are tracking

Ordered within each group. Grouped by **who can do it**, because that is what
decides whether an item is waiting or workable.

### In this repository

1. **`domicile://`, the repo half.** Delete `engine-chrome-host`'s HTTP server
   and `connectToHost`'s WebSocket, and serve the shell over the scheme
   instead. **Cannot land first** — it breaks every desktop until the engine
   can serve the scheme. Blocked on the fork's half.
2. **The SDK's shape.** `<app>` and `<webview>` are real elements now, but the
   SDK still defines `domicile-app` and `domicile-webview` as custom elements
   and still measures and reports placement that patch 0007 does natively — an
   `<app>`'s layout box *is* the `xdg_toplevel.configure`. **Parked**: the
   `domicile://` work may delete the SDK's runtime entirely, and splitting it
   before then would be a seam drawn twice.
3. **Keystroke-to-pixel latency** (#206). The one requirement nothing has
   measured: a client's window must cost the user nothing a plain Wayland
   compositor would not. Guard written, unit-tested, never run on hardware —
   every engine run so far has been refused at the `crux` tree lock.
4. **A control socket, and `domicile load-shell <path>`.** Switching the
   running shell without restarting the desktop, so a watcher outside Domicile
   can trigger a reload and `DOMICILE_DEV_RELOAD` — the poller the bridge
   writes into the page — can go. **After `domicile://`**, which deletes the
   hop it would otherwise be built on. `docs/architecture/THE-DOMICILE-BINARY.md`

### In the engine fork — the agent on `crux`

1. **`domicile://`.** Scheme registration and both loader hooks. In progress.
2. **`<webview>` is a subframe, and that shows.** It is a frame owner, so
   X-Frame-Options and CSP `frame-ancestors` apply and a site that refuses
   framing will not load; and `goBack()`/`goForward()` reach the nested
   context's `History` directly, so they stop working the moment the user
   browses cross-site. Both need browser-side work: a navigation controller and
   a frame tree the guest owns. Chromium has exactly that machinery for its own
   `<webview>` — `extensions`' guest views — which the fork **disabled** to take
   the tag name. Porting it or accepting subframe semantics is the decision.
3. **A desktop on a tty.** `ozone_platform_drm = true` fails at `gn gen` on this
   pin: `assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")`. Needs a
   patch that makes the DRM platform build on Linux, or a `target_os =
   "chromeos"` build, which brings a great deal else. Until then a desktop is a
   window inside an existing Wayland session, or headless.

### Needs a machine with a screen

Nothing here can see one. Say which question a run would answer rather than
guessing between two.

- The first real `./scripts/dev-shell.sh <name>`.
- Anything about orientation, presentation, or what a display does with a
  buffer.
- Re-measuring latency or CSS parity after a change that could move either.

### Undecided

- **Translucent chrome over a window with anything painted behind it.** The
  page cannot see the window's pixels, so a `backdrop-filter` on chrome stacked
  over a window has nothing to blur. Four ways out are costed in
  `WINDOW-COMPOSITING.md`; raster-per-band is where it goes, and its open part
  is transport rather than rendering.
- **`wl_shm` clients.** A client that draws into shared memory has no dmabuf to
  import, so its window is blank and the compositor says so once per client.
  The upload that would give it one does not exist — `ENGINE-FORK.md`, phase 2.

---

## Known gaps

True, understood, and not scheduled. Each is here so that finding it again
costs nothing.

- **A frame in which the chrome repainted reports the whole output damaged.**
  The chrome is one layer covering the desktop, so its commit counter moving
  damages all of it — and it repaints for a clock, a caret, a hover.
- **A mixed-density desktop is drawn at one density**, and **fractional scaling
  rounds up**: a client rendering at 2× downscaled is sharper than one rendering
  at 1× stretched, which is the deliberate choice rather than a bug.
- **A 3D transform or a `zoom` *above* a window is invisible to the SDK.**
  `defaultMeasure` walks the flat tree and reads each ancestor's computed style,
  but an ancestor's perspective does not reach the child's matrix, and `zoom`
  scales the box without being a transform — so the compositor is told two wrong
  things about one window, and an ancestor's `zoom` mispositions it as well.
- **A client that draws its own cursor into a surface gets a plain arrow.**
- **Hot-swapping the chrome page** is a page reload on the engine, and
  `announce_open_apps` is what makes one survivable. `scripts/dev-shell.sh` is
  the only thing that asks for one, on every rebuild; nothing a user runs does.

---

## Working here

### Run and test

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
run by hand. Five have a flake app of their own, for running against a fresh
checkout with no `node_modules` — `dev-check`, `dev-e2e-dmabuf`,
`dev-e2e-chrome-fills-the-desktop`, `dev-smoke-compositor`,
`dev-test-out-of-tree-shell`. Anything else is `nix develop .#full -c
./scripts/<name>.sh`.

Nothing in the suite needs a display.

```sh
# A desktop, on a machine that has a screen.
nix run 'github:cprussin/domicile#manganese'    # the reference shell
nix run 'github:cprussin/domicile' -- ./dist    # a shell of your own
./scripts/dev-shell.sh manganese               # …and rebuilt as you edit
```

The engine job on `crux` is the only thing that builds the fork and drives the
pixel guards. It shares a checkout with whoever else is working there, so it
takes a lock first: `.github/scripts/engine-tree-lock.sh`, which is also what a
person on that machine runs before building by hand.

### Reading the compositor's frame report

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

### Gotchas that will bite you

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
- **A solid-colour texture cannot test a texture matrix** — it looks the same
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

---

## Repo layout

| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema, parse, validate, hot reload | core |
| `packages/domicile-scene` | transforms, hit-testing, pointer routing, z-order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages, versioning | core |
| `packages/domicile-host` | the orchestrator brain and its IPC | core |
| `packages/domicile-launch` | `domicile` itself: which page, which platform, where the components are, and the supervisor that starts them | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server, imports, input, the engine seam | `.#full` |
| `packages/domicile-engine` | the Chromium fork: the patch series, the pin, the published engine | — |
| `packages/engine-chrome-host` | the bridge: serves the shell's page and pipes its session to the compositor | bun |
| `packages/chrome-sdk` | the shell-facing API: elements, `BridgeClient`, measurement, input | bun |
| `packages/component-library` | shared React components, the Panda preset, `shellBuild` | bun |
| `packages/shell-manganese` | the reference desktop: tabs, stage, rail, address bar | bun |
| `packages/shell-simple` | the minimal desktop: floating windows | bun |
| `packages/domicile-test-client` | the stand-in Wayland client the checks open a window with | core |
| `packages/domicile-test-chrome` | the stand-in chrome the compositor's own tests drive | core |
| `packages/e2e-harness` | the headless chrome stand-in, and the check on the e2e machinery | bun |
| `packages/test-support` | shared bun test setup | bun |
| `scripts/` | `check.sh`, the e2e and smoke checks, `dev-shell.sh` | — |
| `.github/scripts/` | what the engine job runs: the tree lock, the reset, the build, the release | — |

Inside `domicile-compositor`: `screens.rs` is what the desktop is made of;
`dmabuf_import.rs` the import; `engine.rs`, `engine_session.rs` and
`engine_buffers.rs` the seam to the fork and what it holds; `outbound.rs` the
queue to the chrome; `scale.rs`, `viewport.rs`, `coalesce.rs`,
`timing_window.rs`, `modifiers.rs`, `latency.rs` are each one small thing named
after itself.

**Two rules the chrome queue is built around, both from freezes.** Never write
to a chrome from the Wayland loop — a chrome that reads slowly fills the socket
buffer and a blocking write stops frame callbacks for *every* client. Never
*wait* on one either: that stalls the thread that injects input, past the 200ms
repeat delay, so a key the user tapped starts repeating. `outbound.rs` gives
frames and lifecycle messages opposite policies, and `tests/backpressure.rs`
holds both halves.

---

## Collaboration notes

Proceed autonomously and follow your own recommendations; stop only when
genuinely blocked on taste or hardware. Keep strict TDD. Commit freely, and open
a pull request for every change.

The standing lesson: **what runs here cannot see a screen**, and the second one,
learned the hard way — **a document that describes a deleted mechanism is worse
than no document**. This file said "there are two paths, and both work" for as
long as there was one.
