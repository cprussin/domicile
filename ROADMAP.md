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

`domicile` is the entry point: `domicile ./my-desktop/dist/shell.js` starts the
engine and the compositor, in the one order they can start in — the engine
first, because it serves the shell over `domicile://` and opens the broker
socket the compositor connects to as a producer. It builds nothing and wraps
nothing: both components ship beside it, the way a multi-binary program like
postfix does, and it finds them from its own path. There were three, and the
bridge that served the page over a loopback HTTP port is gone with the port.

The wire protocol is at `PROTOCOL_VERSION = 1`.

### What is proven, and by what

| Claim | Evidence |
|---|---|
| A window composites at native cost | A submitted frame reaches the display compositor's output in one display frame, indistinguishable from the probe's own floor. `ENGINE-FORK.md`, *What it costs* |
| CSS is structural, not reimplemented | Seven properties measured on a GPU — `z-index` against ordinary DOM, `transform`, `border-radius`, `opacity`, `filter: blur()`, `mix-blend-mode`, resize — every one bit-exact against an ordinary element beside it. `ENGINE-FORK.md`, *What CSS does to an `<app>`* |
| `<app>` and `<webview>` are elements the fork defines | Patch 0007. `document.createElement("app").constructor.name` is `HTMLAppElement`; `app-id` reflects both ways |
| A shell loads over `domicile://`, with no port behind it | Patches 0008 and 0009: a standard scheme, deliberately not web-safe, both loader hooks, the document the fork writes, and `navigator.domicile` bound for that origin — a stand-in compositor read `hello` and a `spawn` back over it. Five gates stand between a registered scheme and a page that loads and all five are through, the last of them `MaybeLaunchAppShortcutWindow`, which declines `--app=domicile://shell/` for a scheme that is not web-safe and launches an ordinary browser window on the New Tab page instead, logging nothing on either side. No desktop binds a loopback port any more: the process that served one is gone, and `connectToHost` takes `navigator.domicile` rather than opening a WebSocket |
| A `<webview>` is a guest, so a site that refuses framing loads in one | `guard-webview-framing.sh`. The element shows a page sending `X-Frame-Options: DENY` and `frame-ancestors 'none'`; its control frames that page and a copy differing only in those two headers from an ordinary http page, and shows the copy and not the original. So the site is refused where it has an ancestor, and the element is not giving it one |
| A desktop chord reaches the shell while a browser window has the keyboard | `guard-webview-keyboard.sh`. A key pressed before focus moves reaches the shell's `document`; the chord after it comes back as `shortcut` and the window never sees it; an ungrabbed key reaches the window's page and not the shell |
| A click inside a browser window reaches the shell that has to raise it | `guard-webview-click.sh`. A press driven at the engine lands in the guest's own page and arrives in the shell's `document` as an event on the element the guest hangs off, which is what a shell raises the window on; its control clicks the shell's own chrome instead and nothing reaches the element. Patch 0011 is both halves of why it crosses: upstream dispatches no focus event across a remote frame's process boundary, and focusing the element across it dispatches none either — Blink suppresses focus events while the page is unfocused, which a guest taking focus always makes it — so the element says so in an event of its own. The first run of the guard, with only the focus, is what found the second half |
| A client's dmabuf imports on AMD | Patch 0005, confirmed on a Radeon 890M on 2026-09-08: kitty survives being floated and resized, on the DCC modifier that used to be refused, with no `gbm_bo_import` failure in the run |
| The desktop a user runs contains all of it | `packages/domicile-engine/engine-release.nix` pins the published engine; `nix run github:cprussin/domicile#manganese` runs it |

---

## What we are tracking

Ordered within each group. Grouped by **who can do it**, because that is what
decides whether an item is waiting or workable.

### In this repository

1. **`<app>` and `<webview>`, not `domicile-app` and `domicile-webview`.** The
   fork defines both as real HTML tags — `document.createElement("app")` is an
   `HTMLAppElement`, `app-id` reflects both ways — and the SDK still registers
   hyphenated custom elements beside them, because a custom element's name must
   contain a hyphen and the SDK predates the fork. `alias-tags.ts` offers a
   chrome the short spelling by upgrading every `<app>` in the document to
   `<domicile-app>`; nothing in this repository calls it, and it could never
   have done the same for `<webview>`, since aliasing a name the host engine
   claims would recurse.

   The work is subtraction, in this order: stop registering the two custom
   elements; delete `alias-tags.ts` with them; write `<app>` and `<webview>` in
   the shells directly; then delete the placement machinery the elements exist
   to drive — `measure.ts`, `observe-placement.ts`, `element-transform.ts`,
   `matrix.ts`, `placement-timing.ts` — because an `<app>`'s layout box *is* the
   `xdg_toplevel.configure` and patch 0007 reports it natively. Each step is
   separately shippable and the last one is the one with the measurements behind
   it. `WRITING-A-SHELL.md` is the contract this breaks, so it moves in the same
   change as the tags.

   **Unblocked.** It was parked in case the `domicile://` work deleted the SDK's
   runtime; it did not.
2. **Keystroke-to-pixel latency** (#206). The requirement is that a client's
   window costs the user nothing a plain Wayland compositor would not.
   `guard-latency.sh` has run on `crux` now — it reads `commit to pixel` at
   28–29 ms against a 16.67 ms display frame on every run so far, which is 1.7
   frames and no stage of its own. What is left is a machine with a screen: the
   runs are in a nested compositor with nothing presenting, and the probe's own
   round trip is inside every figure.

   The chrome-side instruments are gone rather than empty. `roundTrip`, `hop`
   and manganese's `drawTiming` were deleted with the diagnostic line they fed,
   because a shell reading an instrument nothing records into printed
   `rt_ms=0` every interval anyone typed — and a zero is a measurement to
   whoever reads the log. `latency.rs` is where the measurement lives now; the
   engine stamp the browser-to-renderer hop would need is a phase 2 item in
   `ENGINE-FORK.md`.
3. **A control socket, and `domicile load-shell <path>`.** Switching the
   running shell without restarting the desktop, so a watcher outside Domicile
   can trigger a reload. **Unblocked** — it was waiting on `domicile://`, and
   the hop to the page is the engine's now. It is also where dev reload comes
   back from: the poller the bridge wrote into every served document went with
   the bridge, the C++ that writes the document has nothing in its place, and
   `DOMICILE_DEV_RELOAD` is gone rather than left switching nothing on.
   `docs/architecture/THE-DOMICILE-BINARY.md`

### In the engine fork — the agent on `crux`

1. **A browser window cannot say whether back or forward is available.**
   `goBack()`, `goForward()`, `stop()` and `reload()` reach the guest's own
   `NavigationController` now, so the four work — but `CanGoBack()` and
   `CanGoForward()` are answers only the browser process has, and `WebViewGuest`
   has no leg back to the renderer to carry them. An address bar cannot grey out
   a dead button. The work is a client interface passed at `CreateGuest` plus a
   DOM surface for a chrome to read; the mojom records the gap where the next
   person will look.
2. **A desktop on a tty.** Audited against the pin in
   `docs/architecture/A-DESKTOP-ON-A-TTY.md`. Getting `gn gen` to accept
   `ozone_platform_drm = true` is a **patch**: five edits, not one of them
   inside the DRM platform's own logic, because its 49 `.cc` files hold two
   ChromeOS references between them and no `BUILDFLAG(IS_CHROMEOS)` at all — the
   assert is conservative about the platform. Getting a lit screen out of it is
   a **port**, of the embedder ozone/drm has never had off ChromeOS: no
   `PlatformScreen` (`CreateScreen()` is `NOTREACHED()`), nothing that modesets
   without `//ui/display/manager`, no VT handling or input revocation, and no
   route by which a display list reaches the compositor. It is **not a fork**.

   The doc's first plan item is a `gn gen` probe on `crux`, and it is first for
   a reason: a static read cannot see an `is_chromeos`-conditional header three
   targets down or a `visibility` refusal. Until that runs, "a patch" is a
   reasoned answer and not a measured one.

   Until both halves land, a desktop is a window inside an existing Wayland
   session, or headless.

3. **What the engine ships that a desktop never runs.** Chrome carries a tab
   strip, a New Tab page, a settings UI, sign-in and sync. A desktop can reach
   none of it, all of it is built, and all of it is in the ~216 MB release
   tarball and in the attack surface. **Measure before patching**: nobody knows
   whether stripping it saves 5% or 40%, so the work starts with a size figure
   per subsystem and a list of what each `enable_*` argument actually removes.

   One decision is already made. **PDFium stays** — a desktop should render a
   PDF in a window, so `enable_pdf` is not a free win. The separable question is
   the viewer UI (`chrome/browser/resources/pdf` and the
   `//extensions/browser/mime_handler` dependency it drags in), which is a
   different subsystem with a different answer.

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
- **A guest refuses everything an embedder is asked for.** A page in a browser
  window cannot open a second window, and permissions and dialogs route through
  `WebViewGuest`'s `WebContentsDelegate` and are answered by the default. A
  refusal is the answer that has a guard behind it; opening them is one piece of
  work each, and `CreateCustomWebContents` logs when one is refused.
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
| `packages/chrome-sdk` | the shell-facing API: elements, `DomicileClient`, measurement, input | bun |
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
