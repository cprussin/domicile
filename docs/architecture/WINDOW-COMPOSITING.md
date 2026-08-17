# Compositing native windows at parity

Composite each Wayland client's dmabuf **in the compositor**, not inside the
web page, and punch a transparent hole in the page where its `<app>` element
is. That is what every other Wayland compositor does, so it performs like one
by construction. The engine keeps owning layout, styling and hit-testing; it
stops owning the app's pixels.

## Problem

The frame path copies every client frame four times — GPU readback, socket,
Electron IPC clone, `putImageData` — and then the browser uploads it back to
the GPU. Measured on an AMD 890M with kitty at ~1500x1000: ~11ms of compositor
and ~16ms of chrome per frame, ~80MB/s for one window. It scales as pixels²
(HiDPI quadruples it) and linearly in window count. A normal compositor imports
the client's dmabuf as a texture and composites on the GPU: zero copies,
microseconds of CPU, and in the best case direct scanout.

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

Three layers, composited by `domicile-compositor` on the GPU:

```
  chrome-above     engine texture, transparent where apps show through
  app surfaces     each client's dmabuf, transformed per place_portal
  chrome-below     engine texture
```

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
| **Interleaved stacking** — chrome between two app windows | needs one engine layer per interleave; only below/above are free |
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
- **Electron stays for now.** The engine choice only matters for how the chrome
  reaches the compositor as a texture, which is the *last* phase. Nothing below
  depends on CEF.
- **Presentation phasing exploits an asymmetry**: the chrome is nearly static
  while app windows change every frame. A CPU capture of the chrome is
  therefore affordable long before `OnAcceleratedPaint` is — the exact inverse
  of today's cost model, where the chrome is cheap and apps are ruinous.

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
```

Half the page painted a solid band and half painted nothing, and that is
exactly what arrives: 20000 fully-clear pixels beside fully-opaque ones. The
chrome's own content stays solid while the region over an app stays
see-through.

Two consequences, both good:

- **The page's alpha is an ordinary Wayland buffer.** A transparent
  `BrowserWindow` commits ARGB8888; the hole is real alpha in a surface we
  already know how to import, not an engine feature we have to find. The
  open question becomes "does Electron commit real alpha", which is cheap to
  answer.
- **Chrome-over-app comes free.** Draw apps in `draw_order`, then the page on
  top with blending: wherever the page is transparent the app shows through,
  and wherever it has a panel the panel wins. Only chrome *below* an app —
  wallpaper, say — needs a second layer.

This is why `renderer_gl`/`backend_egl` were already the only Smithay backends
enabled: `winit` now has to join them, which the crate deliberately excluded
while the engine was the only thing presenting.

## Plan

Phase 1 — prove one window composites at all:

- [x] scene: `Portal::surface_to_output` and `Scene::draw_order` — the drawing half of `hit_test`, tested against it so the two cannot drift
- [ ] compositor: the CSS matrix as the renderer's — `cgmath::Matrix3::new` takes its arguments column by column, so the six values do not go in in the order they are written
- [x] **probe first**: does a transparent Electron `BrowserWindow` commit a buffer with real alpha when it is a client of Domicile? Yes — `scripts/probe-transparency.sh`
- [ ] compositor: a `winit` output, and Electron launched against Domicile's own socket
- [ ] compositor: draw `draw_order` through `surface_to_output`, then the page's surface over it
- [ ] measure: `rt_ms` for the native path against the copy path, same client, same size
- [ ] decide on the number — parity means `readback_ms` and `ipc_ms` *gone*, not smaller

## Open questions

- **How does the chrome declare "this window is native"?** Recommend a computed
  style probe in `<domicile-app>` rather than an author-set attribute — the
  fallback should be automatic, not something a shell author must remember.
- **Can Electron give the chrome as a texture at all?** Answered, and better
  than expected: as a client of Domicile its window *is* a `wl_surface` we
  import like any other. `OnAcceleratedPaint` and CEF are only needed if that
  turns out not to hold.
- **Does the engine keep GPU compositing as our client?**
  `probe-transparency.sh` reports which it used, and needs a machine with a
  render node to say anything — this container has none, so the alpha result
  above comes from the software path. Either answer is workable: shm for the
  *chrome* costs an upload per frame on a surface that is nearly static, which
  is the asymmetry this design leans on. Worth knowing, not worth blocking on.
