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

## Plan

Phase 1 — prove parity for one window, nested:

- [x] scene: `Portal::surface_to_output` and `Scene::draw_order` — the drawing half of `hit_test`, tested against it so the two cannot drift
- [ ] compositor: composite an imported client dmabuf into a `winit` window through the portal matrix
- [ ] `<domicile-app>`: render an empty transparent box behind a `domicile-native` attribute, keeping the canvas path as the default
- [ ] measure: `rt_ms` for the native path against the copy path on the same client, same window size
- [ ] decide on the number, not the impression — parity means `readback_ms` and `ipc_ms` gone, not merely smaller

Phase 2 — the effects that make an app a CSS element:

- [ ] rounded corners, opacity and shadow in the compositor shader
- [ ] the rotated + rounded + shadowed window from the old spike's success criterion, at native cost
- [ ] chrome above/below as two engine layers
- [ ] per-window fallback to the copy path when the element's computed style needs an unsupported effect

Phase 3 — own the display:

- [ ] chrome as a texture: CPU capture first, `OnAcceleratedPaint` (CEF) after
- [ ] DRM/KMS backend, direct scanout for a fullscreen app

## Open questions

- **How does the chrome declare "this window is native"?** Recommend a computed
  style probe in `<domicile-app>` rather than an author-set attribute — the
  fallback should be automatic, not something a shell author must remember.
- **Can Electron give the chrome as a texture at all, or does Phase 3 force
  CEF?** Recommend assuming it forces CEF and deferring the question; Phases 1
  and 2 do not depend on it.
- **Does hole-punching survive the engine compositing the page into a single
  layer with its own effects applied?** Unknown until Phase 1 runs on hardware.
  This is the one that could invalidate the approach, so Phase 1 exists to
  answer it before anything is built on top.
