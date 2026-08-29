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

Electron was a client of the *host's* compositor — it inherited
`WAYLAND_DISPLAY` from the session that started it — and talked to Domicile only
over a Unix socket. Domicile was headless: no window, no presentation, no
access to the page's pixels. Compositing app windows under the page inverts
that:

| | Before | After |
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
`draw_order`. `packages/domicile-compositor/tests/layers.rs` runs one client on
each socket and checks that the one on the apps' display is the one announced.

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

- [x] damage *reporting* — the frame says which rectangles changed rather than
      "all of it". `damage::between` diffs the painted layers of two frames;
      `damage::reported` decides whether a difference can honestly be taken at
      all, and it is *that* result `submit` is given, because the first frame
      and a resize have nothing to differ against. Drawing only the damage is a
      separate step and not this one: the frame is still composited in full, so
      nothing here depends on what the previous buffer still holds, which is
      the thing a swapchain does not promise.

      Two things it does not yet buy. Smithay's winit backend treats an empty
      damage list as "all of it", so an idle desktop costs the same there
      today; the saving is in partial-rect frames, and in the DRM backend that
      will act on the empty case. And the chrome is one layer covering the
      whole output, so any frame in which the page repainted — a clock, a
      caret — reports everything. Per-surface damage is already taken in
      `commit` and dropped for the chrome.
- [ ] partial redraw — needs buffer age, and needs a screen to be believed
- [ ] DRM/KMS backend, direct scanout for a fullscreen app

The chrome-as-a-texture step this phase used to carry is gone: the engine
commits dmabufs as our client, so its surface needs no capture path of its own.

## Delegated compositing: measured, and the layer tree does not arrive

**This section used to open by asserting that Chromium already emits its layer
tree as Wayland surfaces, and that the only reason it did not do so here was
that no Linux compositor had implemented what it asks for. That was the
premise this whole route rested on, it has now been measured, and it is
false for the engine as it ships.**

Everything the engine asked for was implemented — `wp_viewporter` honoured
rather than merely advertised, `wp_single_pixel_buffer_manager_v1`,
`wp_content_type_manager_v1`, and its own `overlay_prioritizer` and
`zcr_alpha_compositing_v1`. One protocol was left, `wp_color_management_surface_v1`,
and it was ruled out rather than assumed: with the engine's own
`WaylandWpColorManagerV1` feature switched off, so that the protocol is out of
the question entirely, nothing changes.

What `scripts/probe-delegated-compositing.sh` measures on a machine with a
render node, with `WaylandOverlayDelegation` on:

| | |
|---|---|
| subsurfaces, delegation off, 8 composited layers | 0 |
| subsurfaces, delegation on, 1 composited layer | 1 |
| subsurfaces, delegation on, 8 composited layers | **1** |
| subsurfaces with colour management disabled | 1 |
| `place_above` / `place_below` | **0** |
| buffers allocated, by size, for a 600x400 page | **632x442, and only that** |

The count does not follow the page, nothing is ever stacked, and the single
buffer is the size of the whole page. That is the flat raster with one
`wl_subsurface` in front of it: a delegated *root*, not a delegated tree. The
engine is still flattening every layer into one quad and handing it over as one
quad.

**So the fork question is reopened, and this is the evidence that reopens it.**
The argument for not forking was that the layer tree was already on offer and
only needed a compositor to accept it. It is not on offer. What remains is
either an engine that does emit one — a different build, a different
configuration, or a fork — or living with a flattened page and the band
machinery that fakes stacking on top of it.

**One lever is untested**, and it is the last row of the table below that was
never implemented: `surface-augmenter`, Chromium's own `exo` protocol. The
engine never asks for it, so nothing in its logs suggests it matters, and on
ChromeOS — where delegated compositing does produce a quad per layer — `exo`
provides it. Whether the engine gates per-quad delegation on finding an
exo-shaped compositor is not answerable from the outside; the only way to know
is to implement it and re-run the probe. That is the one experiment left before
the negative result above is final.

Everything below this line was written while the premise still stood. It is
kept because the protocol work it describes is real, was done, and is what
makes the measurement above trustworthy — the engine got what it asked for.

`WaylandOverlayDelegation` is a **runtime feature flag, not absent code**. It
defaults on for LaCrOS — which runs against `exo`, the ChromeOS compositor that
implements the protocols — and off everywhere else, because no other compositor
does. A client whose compositor lacks them falls back to the flat path
automatically, which is today's behaviour and is also the failure mode if this
does not work out.

With it on, each quad of the page becomes its own `wl_subsurface`, z-ordered by
`wl_subsurface.place_above` / `place_below`. That is the layer tree, arriving
as separate rasters over a protocol we already speak — and separate rasters are
the whole of what "one raster is already flattened" costs us. A window goes
*between* two of them because the compositor draws both and orders them: no
bands, no round trip, no depth protocol, no `render_band`.

What a compositor has to implement for it:

| | what for | where it comes from |
|---|---|---|
| `wl_subsurface` | one per quad; `place_above`/`place_below` carry the z-order | core Wayland; Smithay has it |
| `wp_viewporter` | scaling a quad's buffer to its destination | core protocol; Smithay has it |
| `single-pixel-buffer` | solid-colour quads without allocating for them | wayland-protocols staging |
| explicit sync | an acquire fence per quad's buffer | `zwp_linux_explicit_synchronization_v1`; upstream has work to go without it on kernel >= 6.0 |
| `surface-augmenter` | rounded corners, clipping, solid colour at pixel precision | **Chromium's own**, defined by `exo`. The only one here that is not a standard protocol |

**Measured, not guessed.** With `--enable-features=WaylandOverlayDelegation,
DelegatedCompositing` and `--vmodule=*wayland*=3`, Chromium says exactly what
it wants and does not get, one line per protocol, and then falls back without
erroring:

```
WARNING ui/ozone/platform/wayland/host/wayland_surface.cc:170] Server doesn't support zcr_alpha_compositing_v1.
WARNING ui/ozone/platform/wayland/host/wayland_surface.cc:185] Server doesn't support overlay_prioritizer.
WARNING ui/ozone/platform/wayland/host/wayland_surface.cc:200] Server doesn't support wp_content_type_v1
WARNING ui/ozone/platform/wayland/host/wayland_surface.cc:214] Server doesn't support wp_color_management_surface_v1.
```

That list is the work, and it is not the list the write-ups gave: it names
`overlay_prioritizer` and `zcr_alpha_compositing_v1`, which none of them
mention, and it does *not* name `surface-augmenter`. Advertising
`wp_content_type_v1` — Smithay has it — removed that line and left the rest,
so the loop is closed: Chromium reports, we implement, it asks for less.

Advertised now, and asserted by `smoke-compositor.sh`:
`wp_single_pixel_buffer_manager_v1`, `wp_content_type_manager_v1`.
`wl_subcompositor` comes with `CompositorState` and was always there.

**`wp_viewporter` was advertised, then taken away, and is back — and that
sequence is the lesson.** A global is a promise to honour what a client says
through it. Chromium reads this one as permission to stop calling
`wl_surface.set_buffer_scale`: with no viewporter it commits a 1280x800 buffer
at scale 2, and with one it commits 2560x1600 at scale 1 and puts the logical
size in `wp_viewport.set_destination`. Advertised while the commit path read
the buffer and its scale and nothing else, every surface became twice its true
logical size — the desktop drawn at double, and every `place_portal` and
pointer coordinate out by the same factor, which is a window that misses its
hole and a button that cannot be clicked. At 1x the two forms coincide, which
is why nothing headless saw it until `e2e-a-dense-display.sh` was written to
run at a fractional scale.

It is honoured now, in `src/viewport.rs`: the destination sizes the surface
wherever a size is taken, and the source crops it where the compositor draws.
`e2e-a-dense-display.sh` is what holds it — with the destination ignored the
chrome's surface reads 2560x1600 against a desktop of 1280x800 and that check
goes red, measured.

One half is honoured on one path only, and it is said out loud rather than
left to be discovered: a *source* rectangle is applied where the compositor
draws the client's buffer, and not on the copy path, where the buffer is read
back and handed to the page and the region that readback takes is the damage
rather than a crop. A client that sets a source and lands on the copy path
gets its whole buffer, and the compositor warns once per window when that
happens. Nothing does it today — Chromium sets a source only on the delegated
path, which is drawn.

Then the two `exo` protocols were vendored and implemented — see
`packages/domicile-compositor/protocols/` and `src/exo.rs` — and their lines
went too. Both are pure hints: neither sends an event back, so answering is
accepting the object and letting the request stand. One is left:

| | what it is |
|---|---|
| `wp_color_management_surface_v1` | standard, but not in Smithay 0.7 |

**No subsurface has arrived, and this container cannot say whether that is the
protocol.** Delegated compositing is a Viz path, and the GPU process does not
start here at all:

```
WARNING ui/ozone/platform/wayland/gpu/wayland_buffer_manager_gpu.cc:456] Failed to initialize drm render node handle.
VERBOSE1 gpu/ipc/service/gpu_init.cc:516] gl::init::InitializeGLNoExtensionsOneOff failed
ERROR   components/viz/service/main/viz_main_impl.cc:189] Exiting GPU process due to errors during initialization
```

There is no DRM render node in this environment, so there is no Viz compositor
to delegate from and no amount of protocol will produce a quad. Whether
`wp_color_management_surface_v1` is the last blocker or merely the last
*warning* is a question for a machine with a GPU. Everything above it is
answered.

**What this does not settle.** With the page arriving as N subsurfaces, the
compositor still has to know *which* depth each window belongs at: the
`<domicile-app>` hole is a quad like any other, and nothing in the subsurface
tree says which portal it is. `place_portal`'s `z_index` is the obvious way to
reconcile the two, and that reconciliation is a real design question rather
than a detail. It is a question about our own code, which is the point.

**The risk.** Off by default on Linux means under-exercised on Linux: we would
be the first compositor driving this path and would find its bugs. Those are
narrow upstream bugs against a supported flag rather than a fork — but "the
flag exists" is not "the flag works", and none of this is settled until a
Domicile advertising these protocols has actually been handed a subsurface per
quad. What the measurement above establishes is that Chromium is willing to
tell us what it needs, in order, without failing: the remaining risk is the
size of two `exo` protocols, not whether the road exists.

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
  | **layer tree** | the compositor merges the engine's compositing layers with the portals in one z-ordered list | **a Chromium fork** *by that route*. CEF's only route out is `OnAcceleratedPaint` — *one* composited texture, the same flat texture. Per-layer depths mean `cc::LayerTreeHost`, the engine-internals project with a per-release rebase cost that this doc already declined. A second route was thought to reach the same place without a fork — delegated compositing — and it has since been measured and does not: the engine delegates the page as one quad however many layers it has. See **Delegated compositing** above |

  **Region-clipped first, and its restriction is not a corner case.** Take
  wallpaper, window, panel. Where the panel overlaps the window, the single
  texel is panel-over-wallpaper. An opaque panel is just the panel, drawn last,
  correct. A *translucent* one shows wallpaper through itself where the window
  should be — and translucent panels are ordinary, which the `opacity` and
  `backdrop-filter` rows of *What CSS survives* above already promise. So this
  buys chrome below a window when the chrome above it is opaque, which is worth
  having and is not the general case.

  **Settled: region-clipped is built, and this restriction stands.**
  `compositor/src/stacking.rs` is the ordering; `Layer::clip` was already the
  confinement. It was almost not built, on the argument that the page resolves
  chrome-against-window itself and only chrome *between two overlapping
  windows* is left — an argument that holds for the two shells in this repo and
  for no other reason. Both paint nothing behind an `<app>` element
  (`window-styles.ts` says so outright), so today the hole really is
  transparent and the flattening above never happens. Add a wallpaper and the
  paragraph above is exact, with one window and no overlap.

  So the split is: ordering fixes what ordering can, which is real and is not
  the wallpaper case, and a shell that wants a translucent panel over a window
  with anything painted behind it still needs a raster per band. Interleaving
  does not close that and does not claim to.

  Escalating such a window to the copy path does fix it — the engine draws the
  window in the page at its element's true `z-index`, so it stacks correctly
  against all chrome by construction — but at the copy path's price, ~35ms a
  frame from the Phase 1 table, for what would be every window under a
  translucent panel. That is an exception's mechanism, not a policy, and it
  trades chrome-vs-window correctness for window-vs-window: the copy-path
  stacking limitation in the Phase 2 plan above.

  **Raster per band is where this goes** if the shell wants translucent chrome
  over a window with anything behind it, because nothing is pre-flattened. Its
  open part is transport, not rendering.

  **Settled: the compositor asks, and the frame that answers says so in its
  own pixels.** The obvious design is for the chrome to label a commit — "this
  frame is band 2" — over the connection the commit rides on, and that cannot
  be built here. The chrome is a page in Electron; the Wayland connection is
  *Chromium's*, not the page's, so the page cannot add a request to that
  stream. A label sent over the chrome protocol socket instead crosses a
  different transport, and nothing orders a Unix-socket write against a Wayland
  commit: the compositor would be matching frames to labels by arrival and
  would eventually get it wrong, silently, in a way that looks like a stacking
  bug.

  Four ways out:

  | | ordering | cost |
  |---|---|---|
  | **N surfaces** — one Electron window per band | solved by construction: each band is its own `wl_surface` | N renderer processes, each holding the shell's state, and the shell's own state sync between them |
  | **Tag over the socket** | unordered against the commit; matched by arrival | cheap and wrong |
  | **The compositor asks, one band at a time** | one outstanding request, so the next chrome commit is *presumed* to be that band | a socket round trip per band, per chrome repaint — and every unrelated repaint filed as an answer |
  | **A label in the picture** — the page paints the band into one pixel | in the frame, so nothing can reorder it against the frame | one pixel read back per commit, while a band is outstanding |

  The last two are what is built, and they answer different halves. The asking
  is what keeps *one* question outstanding, so a label only has to be told from
  the band actually asked for. The label is what makes a commit attributable at
  all: the page cannot tag the stream, but it can decide what the frame looks
  like, so it paints the band into the top-left pixel and the compositor reads
  it back. See `domicile-protocol/src/band_label.rs`.

  Together they cost a socket round trip per band per chrome repaint, and
  nothing on an idle desktop, which is most of them. They keep one renderer and
  one copy of the shell's state, which is the thing the architecture is for.

  **Built**, in `compositor/src/bands.rs`: `declare_bands` from the chrome,
  `render_band` back, a texture per band rather than the single
  `chrome_texture`, and drawing that waits for the whole set — half-answered is
  a state any repaint passes through, and a frame from a partial set is the
  desktop with a layer missing. The textures are kept between frames so a
  desktop that has not repainted redraws without asking again.

  **What the label bought.** Before it, a chrome had to commit *nothing else*
  while a band was outstanding: a repaint of its own — a clock, a caret, a
  hover — was a commit the compositor could not tell from the answer, and
  taking it as one filed every later band under the wrong depth, silently. That
  was an obligation on the chrome that a live shell cannot honour, because the
  things that repaint a page are not all the shell's to stop.

  Now such a repaint carries the label of whatever band was painted last, which
  is not the band being asked for, and the compositor takes it for what it is:
  the bands it holds are pictures of a page that has moved on, so it drops them
  and starts the round trip again. The question is *not* taken back — the
  chrome was asked for a band and is still going to render it — so there is
  never a second answer in flight. What a repaint costs is a round trip, not a
  layer at the wrong depth.

  A chrome that declares nothing takes on none of this and is drawn as one
  layer over every window, as before.

- **What the number actually is.** Everything through the draw is in place and
  tested, but the only measurement so far is of the copy path. Phase 1 is not
  done until `rt_ms` says what this costs against it.
- **The desktop is only as resizable as one window** — where no displays are
  configured. There, the output's logical size follows Domicile's window and
  the chrome is reconfigured to match, which is what a nested compositor can
  do unaided.

  More than one output *is* modelled now, which this used to deny: a config
  can describe a desktop of several displays, each with its own position and
  scale, and a window is entered onto the ones it is actually over
  (`Screens::entered_by`) — or onto every one of them where it is over none,
  which is a deliberate fallback rather than an omission: a toolkit told it is
  on no output at all waits for one and maps blank. The list is no longer
  fixed at startup either — the compositor watches its config and takes up a
  changed one while running. What
  is still fixed until the DRM/KMS backend of Phase 3 is a *real* display: the
  described ones are regions of Domicile's own window.
