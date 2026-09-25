# How a window reaches the screen

A window belonging to a Wayland client is a `cc::SurfaceLayer` in the shell's
own page. That one sentence is the architecture; everything below is what
follows from it.

```
  wayland client ──dmabuf──▶ domicile-compositor ──CompositorFrame──▶ viz ──┐
                             (Smithay server, viz producer)                 │ aggregates
                                                                            ▼
  the page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ────────┴─▶ display
```

The compositor hands the client's dmabuf to the browser, which imports it as a
`SharedImage`; the compositor adopts the result with
`gpu::ClientSharedImage::ImportUnowned` and submits its own `CompositorFrame`,
carrying a `TextureDrawQuad`, into a viz surface. The page's `<app>` element
embeds that surface. Viz aggregates both into one display frame — the same
single composite any Wayland compositor performs. No pixel is copied by the
CPU, and no frame crosses a socket.

Viz's `OverlayProcessor` can promote a texture quad to direct scanout, and
nothing here stops it from promoting a window's — but no run has: a
`SharedImage` may claim `SCANOUT` only if the buffer was allocated for it, and
nothing that has run these measurements had a display to allocate against. See
`ENGINE-FORK.md`, *What the port measures*. Treat promotion as a property of
viz rather than a measured property of this design.

`docs/architecture/ENGINE-FORK.md` is the engine side: the design, the patch
series, and the measurements.

## What the page and the compositor each know

They meet at a `viz::SurfaceId` and nowhere else.

- **The page never sees a pixel of a window.** It lays out an `<app>`, and the
  element's layout box *is* the client's `xdg_toplevel.configure`. This is why
  a shell cannot screenshot a window, tint one by reading it, or draw anything
  derived from its contents.
- **The compositor never sees the page's layout.** It is told which app a
  surface belongs to and nothing about where it sits, what is over it, or what
  CSS applies to it.
- **A commit belongs to Chromium, not to the page.** The Wayland connection is
  the engine's; a shell's JavaScript cannot add a request to that stream, which
  is what makes anything the page says about a frame unordered against the
  frame itself.

## What CSS does to a window

Whatever works on a hardware-composited `<video>`, because it is the same layer
type through the same property trees. Measured on a GPU against an ordinary
element laid out beside it — `z-index`, `transform`, `border-radius`,
`opacity`, `filter: blur()`, `mix-blend-mode` and a resize — **every one is
bit-exact**. An `<app>` is not a `<div>` up to an outline; it is a `<div>`.
`ENGINE-FORK.md` has the table. The same cells run again with a
`backdrop-filter` stacked over them, and that one is asserted rather than
reported — see *What is open*.

Nothing here is reimplemented, and that is the point of the fork rather than a
detail of it: an effect works because the page's compositor applies it to a
layer, so there is no list of supported properties to keep in step with CSS.

## What is open

- **Translucent chrome over a window.** A `backdrop-filter` on chrome stacked
  above an `<app>` should blur the window beneath it, the way one over a
  hardware-composited `<video>` does. `SkiaRenderer` applies a backdrop filter
  with `saveLayer(SkCanvasPriv::ScaledBackdropLayer(...))` on the canvas of the
  render pass the filtered quad sits in (`skia_renderer.cc:1785` at the pin),
  and by then aggregation has drawn the window's quad into that same pass. So
  the filter has the window's pixels to read.

  **`guard-css-and-resize.sh` asks now, and what it asserts is this:** it runs
  `spike-css-page.html` a second time with `?backdrop-filter=`, which stacks a
  filtering element over every property cell, and every one of those cells has
  to come out the way it does unfiltered — an `<app>` under a filter is a
  `<div>` under the same filter, pixel for pixel. A filter with none of the
  window's pixels to read leaves the two halves of every cell disagreeing,
  which is the failure. The run's last cell takes the filter on its ordinary
  half alone, so a filter that did nothing at all fails there rather than
  passing as parity — an unfiltered run of that page is the run above, and it
  passes. The value is a per-pixel filter rather than a blur, because the
  verdict is read off interior pixels and a blur carries a resampled edge into
  them; `BACKDROP_FILTER='blur(8px)' GPU=1` is the blur measurement, on the
  hardware where there is no edge to carry. **What comes back is CI's to say.**
  The guard runs on `crux`, and this is what it asserts rather than a result.

  **The way it could fail is overlay promotion** — the optimization named at
  the top of this doc. A quad viz puts on a hardware plane is not in the render
  pass a backdrop filter reads from, so a promoted window would leave the
  filter nothing to blur. Read at the pin, viz declines exactly that:
  `OverlayCandidateFactory::IsOccludedByFilteredQuad`
  (`components/viz/service/display/overlay_candidate_factory.cc:280`) calls a
  quad occluded when any `AggregatedRenderPassDrawQuad` above it carries
  non-empty `backdrop_filters`, and `OverlayStrategyUnderlay`
  (`overlay_strategy_underlay.cc:61`) skips a candidate that answers yes —
  "filters read back the framebuffer", in its own comment.
  `OverlayStrategySingleOnTop` never proposes one either, because `IsOccluded`
  refuses any candidate an earlier visible quad overlaps at all. So the
  expected answer is still that it works, and the check is the reason rather
  than luck. One exception to know: the underlay test is
  `!candidate.requires_overlay && ...`, so a quad viz *must* scan out —
  protected content — is promoted under a filter anyway.

  **And that half stays open whatever the guard says.** It runs headless and
  software-composited, where no quad is a candidate for a hardware plane at
  all, so a pass there is the filter reading a window's quads out of a render
  pass and nothing about the decline. Promotion wants a lit CRTC, which is the
  same thing presentation wants — `ENGINE-FORK.md`, phase 3.
- **`wl_shm` clients.** A client that draws into shared memory has no dmabuf to
  import, so its window is blank and the compositor says so once per client.
  The upload that would give it one does not exist — `ENGINE-FORK.md`, phase 2.
- **Damage.** The seam carries a rectangle —
  `domicile_surface_submit(surface, buffer, damage)`, where an empty one means
  the whole surface — and `publish_frame` passes an empty one for every commit,
  so every client frame damages its window entire. Mapping a client's reported
  damage onto it is its own correctness question: a wrong rectangle leaves
  stale pixels on screen, and judging that wants a screen.

## Why the engine is forked at all

This is worth keeping only because it is the question every reader arrives
with, and the answer was measured rather than argued.

An unforked engine hands out its page as **one flat raster**, however many
compositing layers it has. `STACKING-PARITY.md` has the evidence, including
the delegated-compositing route that looked like a way out and was not. With
one raster, a window can only be interleaved with the chrome by splitting the
chrome into bands and rendering each separately — which puts a `data-band`
attribute on every painting element in every shell, and so fails the two
requirements the project exists for: a window that behaves like an ordinary
element, and a shell that is an ordinary page.

Embedding a surface needs neither a flat raster nor a band: `cc` already draws
foreign surfaces, in production, on every page with an out-of-process
`<iframe>`.
