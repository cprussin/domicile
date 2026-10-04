# How a window reaches the screen

A Wayland client's window is a `cc::SurfaceLayer` in the shell's page. Why the
engine is forked: [ENGINE-FORK.md](ENGINE-FORK.md#problem).

```
  wayland client ──dmabuf──▶ domicile-compositor ──CompositorFrame──▶ viz ──┐
                             (Smithay server, viz producer)                 │ aggregates
                                                                            ▼
  the page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ────────┴─▶ display
```

1. The browser imports the client's dmabuf as a `SharedImage`.
2. The compositor adopts it with `gpu::ClientSharedImage::ImportUnowned`.
3. The compositor submits a `CompositorFrame` with a `TextureDrawQuad` into a
   viz surface.
4. The page's `<app>` element embeds that surface.
5. Viz aggregates the page and the window into one display frame.

The CPU copies no pixels, and no frame crosses a socket.

Viz may promote a window's quad to direct scanout. Untested: `SCANOUT` requires
a buffer allocated for a display, and no test setup has one.

[ENGINE-FORK.md](ENGINE-FORK.md) covers the engine side and
[ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md) the measurements.

## What each side knows

The page and the compositor share only a `viz::SurfaceId`.

- **The page sees no window pixels.** It lays out an `<app>`, and the
  element's layout box becomes the client's `xdg_toplevel.configure`. A shell
  cannot screenshot a window or draw anything derived from its contents.
- **The compositor sees no page layout.** It knows which app a surface belongs
  to, but not where it sits, what covers it, or what CSS applies.
- **The Wayland connection belongs to the engine.** Shell JavaScript cannot add
  requests to it. Messages from the page about a frame are not synchronized
  with that frame's commit.

## What CSS does to a window

Anything that works on a hardware-composited `<video>` works on an `<app>`. Both
are the same layer type in the same property trees, so there is no list of
supported properties to maintain.

Measured against an ordinary element laid out beside it, an `<app>` matches
pixel for pixel on the GPU for `z-index`, `transform`, `border-radius`,
`opacity`, `filter: blur()`, `mix-blend-mode` and resize. See
[ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md#css-parity).

## What is open

### `backdrop-filter` over a window

Translucent chrome above an `<app>` should blur the window beneath it.

- **Why it should work:** `SkiaRenderer` applies the filter on the render pass
  that already contains the window's quad (`skia_renderer.cc:1785` at the pin).
- **Risk: overlay promotion.** A promoted quad is not in the render pass the
  filter reads. At the pin, viz does not promote a quad under a backdrop
  filter, except protected content (`requires_overlay`). Source references:
  [ENGINE-FORK-CHROMIUM-NOTES.md](ENGINE-FORK-CHROMIUM-NOTES.md#backdrop-filters-and-overlay-promotion).
- **The check:** `packages/domicile-engine/scripts/guard-css-and-resize.sh`
  (run by `scripts/engine-guard-css-and-resize.sh` on `crux`) reruns
  `spike-css-page.html` with `?backdrop-filter=`.
  - Each test cell shows an `<app>` next to a `<div>`. With the filter on, both
    halves must still match.
  - The last cell filters only the `<div>`, so a filter that does nothing
    fails.
  - The default filter is `invert(1)`. Blur spreads edge pixels into the
    compared area, so blur is measured only on hardware:
    `BACKDROP_FILTER='blur(8px)' GPU=1`.
  - Result: pending on `crux`.
- **Still open after the guard passes.** The guard runs headless and
  software-composited, where no quad is an overlay candidate. Testing that
  viz declines promotion needs a lit CRTC
  ([ENGINE-FORK.md](ENGINE-FORK.md#plan)).

### `wl_shm` clients on a GPU

A `wl_shm` client has no dmabuf. The compositor copies each frame into its own
GBM buffer and submits that (`uploads.rs`, `shm_upload.rs`). The copy is tested
on llvmpipe. The GBM allocation and the browser's import are not, because no
check has a render node ([ENGINE-FORK.md](ENGINE-FORK.md#plan)).

### Damage

`domicile_surface_submit_crop(surface, buffer, crop, damage)` takes a damage
rectangle, where empty means the whole surface. `publish_frame` always passes
an empty one, so every commit damages the whole window. Mapping the client's
reported damage needs a screen to verify: a wrong rectangle leaves stale pixels.
