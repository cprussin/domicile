# Compositing native windows at parity

Composite each Wayland client's dmabuf **in the compositor**, not inside the
web page, and punch a transparent hole in the page where its `<app>` element
is. That is what every other Wayland compositor does, so it performs like one
by construction. The engine keeps owning layout, styling and hit-testing; it
stops owning the app's pixels.

## Problem

The frame path copies every client frame four times — GPU readback, socket,
context-bridge clone into the page, `putImageData` — and then the browser
uploads it back to the GPU. Measured on an AMD 890M with kitty at ~1500x1000:
~11ms of compositor and ~16ms of chrome per frame, ~80MB/s for one window. It
scales as pixels² (HiDPI quadruples it) and linearly in window count. A normal
compositor imports the client's dmabuf as a texture and composites on the GPU:
zero copies, microseconds of CPU, and in the best case direct scanout.

The existing plan was to fix this by getting client dmabufs *into* the page as
external textures. That plan does not survive contact with the API.

## The finding that decides it

CEF's dmabuf support runs one way only, and it is the wrong way for that plan
and the right way for this one:

| Direction | Status |
|---|---|
| Page **out** as a dmabuf — `OnAcceleratedPaint` / `cef_accelerated_paint_info_t`, which carries "planes of the shared texture (usually file descriptors of dmabufs)" | Exists since ~CEF 132. Rough on Linux: [cefclient has no implementation](https://github.com/chromiumembedded/cef/issues/3687), so it is not exercised upstream. |
| Client dmabuf **in** to the page | **No API.** |

Neither route the old spike proposed clears that second row:

- **`<video>` / media source.** Chromium's zero-copy video path expects frames
  produced *inside its own GPU process* via `GpuMemoryBuffer`. There is no
  public surface for handing it a dmabuf from another process.
- **WebGPU `GPUExternalTexture`.** `importExternalTexture()` takes an
  `HTMLVideoElement`, so it reduces to the first route rather than avoiding it.

The remaining option is the old doc's own fallback — patch a privileged
"bind dmabuf → texture" into the engine — which is a Chromium-internals project
with a rebase cost on every release, to be paid before knowing whether the rest
of the architecture works.

Hole-punching needs only the row that exists.

## Design

Composited by `domicile-compositor` on the GPU:

```
  chrome           engine texture, transparent where apps show through
  app surfaces     each client's dmabuf, transformed per place_portal
```

One chrome texture, drawn last. Putting chrome *under* a window, or between
two, means drawing that texture more than once — the mechanism is an open
question below, and CSS `z-index` is the authoring model whichever way it is
answered.

The chrome already reports everything the compositor needs — `place_portal`
sends a full CSS matrix, size, `z_index` and visibility per `<app>`, and
`domicile-scene` already inverts that matrix for hit-testing. The compositor
draws each client's texture through that matrix instead of the chrome drawing
a canvas.

What changes, by component:

| Component | Today | After |
|---|---|---|
| `domicile-compositor` | reads back, sends pixels | imports dmabuf, composites through the portal matrix |
| `AppFrame` protocol message | carries the pixels | **deleted** — the compositor never sends app pixels |
| `<domicile-app>` | owns a `<canvas>` | owns an empty transparent box; still measures and reports itself |
| `domicile-host` / `domicile-scene` | unchanged | unchanged |

Input, focus, portal placement, the config, and the whole host brain are
untouched: they never dealt in pixels.

## What CSS survives

The compositor's shader replaces the engine's for app content, so the effects
have to be reimplemented. The common ones are cheap; the long tail is not.

| Effect | How |
|---|---|
| `transform` (affine: translate/scale/rotate/skew) | the matrix we already receive |
| `border-radius` | rounded-rect SDF mask |
| `opacity` | alpha multiply |
| `box-shadow` | blurred rounded rect behind the quad |
| `backdrop-filter` on chrome above an app | blur sample of the composited result |
| **Interleaved stacking** — chrome between two app windows | the chrome texture is drawn once, last; interleaving means drawing it more than once — open question below |
| Arbitrary `filter`, `clip-path`, `mask`, 3D perspective, blend modes | not reimplemented |

**Keep the copy path as the fallback.** A window whose element needs an effect
the compositor cannot do falls back to today's readback for that window only.
Correct always, fast almost always, and it makes this change incremental rather
than a rewrite: the copy path already works and stays as the slow path.

## Key decisions

- **Hole-punch over engine-internal textures**, because the API for the latter
  does not exist and the API for the former does.
- **The engine is still the renderer.** It lays out, styles, hit-tests and
  draws all chrome. It stops rasterising app content, which was never its
  strength — that is a compositor's job and we already are one.
- **Electron stays.** The engine reaches the compositor as an ordinary Wayland
  surface, so the engine choice no longer gates anything. CEF becomes a
  question of which engine to embed rather than of whether this can work.
- **The engine is a Wayland client, not a special case.** It commits dmabufs
  like anything else, so there is one import path rather than one for apps and
  another for the chrome — and no capture API to depend on.

## What has to change structurally

Electron is currently a client of the *host's* compositor — `run-prototype.sh`
lets it inherit `WAYLAND_DISPLAY` — and talks to Domicile only over a Unix
socket. Domicile is headless: no window, no presentation, no access to the
page's pixels. Compositing app windows under the page inverts that:

| | Today | After |
|---|---|---|
| Electron's `WAYLAND_DISPLAY` | the host's | Domicile's |
| Electron's window | a surface the host composites | a `wl_surface` Domicile owns |
| Domicile's output | none (headless) | a `winit` window, later DRM/KMS |
| Chrome pixels | never leave Electron | a texture Domicile composites |

Both halves of that are verified — `scripts/probe-transparency.sh` runs a
transparent Electron window against Domicile's own socket and reads the alpha
channel of what it commits:

```
PASS: the engine connected to Domicile and mapped a toplevel
alpha app_id=app-1 200x200 frames=2 pixels=40000 min=0 max=255 clear=20000
PASS: opaque and clear pixels in one buffer (min=0, max=255, 20000 clear)
GPU: the engine committed a dmabuf — its buffer imports with no copy,
     which is the same path a Wayland client's frames take.
```

Half the page painted a solid band and half painted nothing, and that is
exactly what arrives: 20000 fully-clear pixels beside fully-opaque ones. The
chrome's own content stays solid while the region over an app stays
see-through.

Three consequences, all good:

- **The page's alpha is an ordinary Wayland buffer.** A transparent
  `BrowserWindow` commits ARGB8888; the hole is real alpha in a surface we
  already know how to import, not an engine feature we have to find.
- **The chrome costs no copy either.** With a render node present the engine
  commits a *dmabuf*, so its surface imports exactly like a client's. Nothing
  in the frame path is copied by the CPU any more, which was the whole target.
- **Chrome-over-app comes free.** Draw apps in `draw_order`, then the page on
  top with blending: wherever the page is transparent the app shows through,
  and wherever it has a panel the panel wins. Chrome *below* an app —
  wallpaper, say — means drawing the chrome texture a second time.

This is why `renderer_gl`/`backend_egl` were already the only Smithay backends
enabled: `winit` now has to join them, which the crate deliberately excluded
while the engine was the only thing presenting.

## Plan

Phase 1 — prove one window composites at all:

- [x] scene: `Portal::surface_to_output` and `Scene::draw_order` — the drawing half of `hit_test`, tested against it so the two cannot drift
- [x] compositor: the CSS matrix as the renderer's — `cgmath::Matrix3::new` takes its arguments column by column, so the six values do not go in in the order they are written
- [x] **probe first**: does a transparent Electron `BrowserWindow` commit a buffer with real alpha when it is a client of Domicile? Yes — `scripts/probe-transparency.sh`
- [x] compositor: a `winit` output behind `--present`, one renderer shared with the import path (`scripts/run-native.sh`)
- [x] compositor: draw `draw_order` through `surface_to_output`, then the page's surface over it
- [x] compositor: the window's own input, on a seat the chrome owns
- [x] measure: the two paths against each other, same client, same size
- [x] decide on the number

**The number.** AMD Radeon 890M, kitty, a keystroke every 250ms, release build,
`nix run .#measure`:

Measured on a copy path that read and sent the whole window every frame, which
is no longer what it does: damage tracking narrowed the wire and the readback
now reads only what is about to be sent, so `readback_ms`, `write_ms` and
`mb_per_s` all scale with what the client changed. The figures below stand as
the *full-frame* case — a first frame, a resize, a hand-over — and as what the
native path is measured against.

| per frame | copy | native |
|---|---|---|
| `readback_ms` | 7–8 (worst 9) | 0 |
| `write_ms` | 27–28 | 0 |
| `commit_ms` | 7–8 | 0 |
| `composite_ms` | — | 0 (worst 2–3) |
| `mb_per_s` | 80–123 | 0 |
| `response_ms` | 3–4 (worst 5) | 3–4 (worst 6) |

Measured before `composite_ms` and `submit_ms` were split, so its figures
include the buffer swap and are an upper bound on the same work today.

The compositor's work per frame goes from ~35ms — 8 on the Wayland thread, 27 on
the writer thread — to under a millisecond, 3ms at worst. Socket traffic goes to
zero. `response_ms` is the client's own redraw and is unchanged, which is the
thing worth ruling out: compositing in our process does not delay the client.

Gone, not smaller. The approach is justified and Phase 2 can build on it.

**What is still not measured:** `rt_ms` and `ipc_ms`, on either path. Both are
timed by the chrome from the keystroke *it* sent, and the harness types over the
socket instead — which is what makes the two runs comparable and what puts the
chrome's clock out of the loop. Their absence in the output is a gap, not a
result. What the native run does establish is `sent=0`: nothing crosses the
socket, so nothing crosses the hop those numbers measure.

**How the chrome is told from an app.** It arrives on a Wayland socket of its
own, `<display>-chrome`, and `ClientState::is_chrome` follows from which socket
a client connected on. Not an `xdg_toplevel` app id: that is set by the client,
whenever the client feels like sending it, which is not necessarily before the
toplevel it names. A chrome mistaken for an app would be announced to itself and
mount an `<app>` element for itself, inside itself.

**How the window's input reaches anything.** On the one seat, which the chrome
and the windows take turns on. A seat each — so that both could hold a focus at
once — is the obvious design and does not survive contact with a client: GTK
asserts on the second seat and Electron drops the connection.

The **keyboard** goes to whatever holds focus. The chrome holds it until it says
a window has been focused and gets it back when it says one has not, and a
window that cannot be focused (one that closed while the message was in flight)
leaves it with the chrome rather than nowhere — a keyboard focused on nothing is
a desktop that has gone permanently deaf. While a window holds it, the chrome's
own shortcuts do not reach the chrome; intercepting those in the compositor is
the answer and is not written yet.

The **pointer** is routed by the compositor, through the same
`Scene::route_pointer` the chrome would have used, and a press focuses what is
under it. Not by the chrome, even though it could: one seat has one pointer
focus, and two things driving it means whichever moved it last gets the next
click — a window that tracks the mouse and never receives a press. That also
takes the chrome out of the pointer path, which the copy path pays a socket
round trip per motion for.

The chrome's toplevel is therefore kept out of `toplevels` entirely — never
announced, never placed by a portal, drawn last over everything rather than in
`draw_order`. `scripts/e2e-chrome-layer.sh` runs one client on each socket and
checks that exactly one of them becomes a window.

Phase 2 — the effects that make an app a CSS element:

- [x] rounded corners and opacity in the compositor shader — `place_portal`
      carries the element's `border-radius` and `opacity`, and the shader
      applies a rounded-rect SDF and an alpha multiply to the client's own
      buffer. One radius, not four: it is what can be applied without knowing
      which way up a client's buffer is.
- [x] shadow — the first effect that draws *outside* the quad, so it gets
      geometry of its own: a second quad, grown by the spread and the blur and
      moved by the offset, drawn under the window by a second shader which cuts
      the window's own shape back out of it. CSS clips an outer shadow to
      outside the border box, so a translucent window must not show the shadow
      it casts through itself. `place_portal` carries the element's computed
      `box-shadow`; an `inset` one is reported as no shadow, and a colour in a
      syntax the SDK cannot read is reported to the console rather than
      silently dropped.
- [x] the rotated + rounded + shadowed window from the old spike's success
      criterion is drawn correctly, held by pixel tests over a window turned 45
      degrees
- [x] ...and at native cost: measured again after the shadow work. The table is
      in `ROADMAP.md`.
- [ ] interleave chrome and windows by CSS `z-index` — the shell writes it and
      the compositor honours it, in the stacking space the portals are already
      reported in. The mechanism is the open question below — region clipping
      or a raster per band, both of which need nothing from the engine.
- [x] per-window fallback to the copy path when the element's computed style
      needs an unsupported effect. The SDK names what the shaders cannot draw
      and sends `native: false` with the placement; the compositor draws
      nothing for that window and reads its buffer back instead, exactly as it
      did before any of this. One window, not the desktop. Both moments a
      window changes paths are the compositor's to cover, because the *page*
      changed and the client did not: leaving, it hands over the buffer it is
      already holding, and returning, it tells the chrome with `app_composited`
      so the canvas goes only once there are pixels to put in its place.
- [x] re-measure on style, not only on size: every portal is measured on each
      animation frame, so a rule that starts matching a window already on the
      stage moves it when the pointer arrives rather than whenever something
      next resizes it.
- [ ] the fallback inherits the interleaved-stacking limitation, and makes it
      reachable one window at a time: the page is drawn over all of the app
      surfaces rather than in the stacking order, so a window whose pixels move
      into the page is drawn above every natively-drawn window it overlaps,
      whatever its `z-index`. Interleaving by `z-index`, above, fixes this and
      the chrome-between-two-windows case together.

Phase 3 — own the display:

- [ ] DRM/KMS backend, direct scanout for a fullscreen app

The chrome-as-a-texture step this phase used to carry is gone: the engine
commits dmabufs as our client, so its surface needs no capture path of its own.

## Open questions

- ~~**How does the chrome declare "this window is native"?**~~ Settled: it does
  not declare it. `<domicile-app>` reads its own computed style whenever it
  measures and decides, so an author who writes a `filter` gets a correct
  window without knowing this document exists. What they get told is the
  *cost*, once per property, on the console. The compositor answers with
  `app_composited` when it has taken a window back — the chrome cannot work
  that out for itself, because a `wl_shm` client is never drawn natively
  however ordinary its CSS.
- ~~**What makes a window re-measure?**~~ Settled: an animation frame. A
  `ResizeObserver` sees a box change size and nothing else, and none of the
  things a chrome does to a window most often changes its size — moving it,
  animating a transform, a `:hover` filter, a class toggle. The browser has no
  "this box moved" event, so the box is read once per frame, which is the rate
  at which the page can change anyway. One loop for every portal, and an
  element that measures what it measured last frame sends nothing, so a still
  desktop is silent.
- **How chrome and windows interleave.** The authoring model is settled: plain
  CSS `z-index`, no container to opt into and no Wayland concept in the page.
  The mechanism is not.

  The chrome is one client on its own socket (`ClientState::is_chrome`), one
  `chrome_texture`, pushed into `layers` after the `draw_order()` loop — drawn
  once, last, over everything. A texture carries no per-fragment depth, so it
  cannot be sliced by z.

  **What decides this: one raster is already flattened.** The page composites
  its own content before we ever see it, so wherever chrome that belongs below
  a window and chrome that belongs above it cover the same pixel, that texel is
  already blended and nothing downstream can unblend it. Every mechanism that
  slices a single raster inherits that; only rendering the bands separately
  escapes it.

  | | how | cost |
  |---|---|---|
  | **region-clipped** | a clip-rects field on `Layer`, passed to `render_texture`'s `instances` (which `draw_layers` currently passes `None`); push the chrome `Layer` into `layers` once per band | N quads for N bands. Correct only where the upper band is **opaque** over the lower — see below |
  | **raster per band** | the chrome rasterises N views of the same DOM, each with the other bands hidden, and the SDK generates the views | N rasters, plus transport: `chrome_toplevel` and `chrome_texture` are single `Option`s, so N textures means N surfaces or N frames the compositor caches |
  | **many surfaces** | one transparent toplevel per band | the transport cost above, and the shell must partition its DOM — Wayland back in the page |
  | **layer tree** | the compositor merges the engine's compositing layers with the portals in one z-ordered list | **a Chromium fork.** CEF's only route out is `OnAcceleratedPaint` — *one* composited texture, the same flat texture. Per-layer depths mean `cc::LayerTreeHost`, the engine-internals project with a per-release rebase cost that this doc already declined |

  **Region-clipped first, and its restriction is not a corner case.** Take
  wallpaper, window, panel. Where the panel overlaps the window, the single
  texel is panel-over-wallpaper. An opaque panel is just the panel, drawn last,
  correct. A *translucent* one shows wallpaper through itself where the window
  should be — and translucent panels are ordinary, which the `opacity` and
  `backdrop-filter` rows of *What CSS survives* above already promise. So this
  buys chrome below a window when the chrome above it is opaque, which is worth
  having and is not the general case.

  Escalating such a window to the copy path does fix it — the engine draws the
  window in the page at its element's true `z-index`, so it stacks correctly
  against all chrome by construction — but at the copy path's price, ~35ms a
  frame from the Phase 1 table, for what would be every window under a
  translucent panel. That is an exception's mechanism, not a policy, and it
  trades chrome-vs-window correctness for window-vs-window: the copy-path
  stacking limitation in the Phase 2 plan above.

  **Raster per band is where this goes** if the shell wants translucent chrome
  over a window with anything behind it, because nothing is pre-flattened. Its
  open part is transport, not rendering. Settle that before building region
  clipping if the shell's panels are translucent; region clipping is the
  cheaper first step only if they are not.

- **What the number actually is.** Everything through the draw is in place and
  tested, but the only measurement so far is of the copy path. Phase 1 is not
  done until `rt_ms` says what this costs against it.
- **The desktop is only as resizable as one window.** The output's logical size
  follows Domicile's window and the chrome is reconfigured to match, which is
  what a nested compositor can do. A real display is fixed until the DRM/KMS
  backend of Phase 3, and more than one output is not modelled at all: the
  scene has a single `surface_to_output`.
