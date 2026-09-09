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

The compositor imports the client's dmabuf as a `SharedImage` and submits it
into a viz surface. The page's `<app>` element embeds that surface. Viz
aggregates both into one display frame — the same single composite any Wayland
compositor performs — and its `OverlayProcessor` can promote the quad to direct
scanout. No pixel is copied by the CPU, and no frame crosses a socket.

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
`ENGINE-FORK.md` has the table.

Nothing here is reimplemented, and that is the point of the fork rather than a
detail of it: an effect works because the page's compositor applies it to a
layer, so there is no list of supported properties to keep in step with CSS.

## What is open

- **Translucent chrome over a window.** A `backdrop-filter` on chrome stacked
  above an `<app>` should blur the window beneath it, the way one over a
  `<video>` does — the backdrop is read from the page's own render surface, and
  the window is in it. Nobody has run it. Until someone does, treat it as
  likely-correct and unmeasured rather than promised.
- **`wl_shm` clients.** A client that draws into shared memory has no dmabuf to
  import, so its window is blank and the compositor says so once per client.
  The upload that would give it one does not exist — `ENGINE-FORK.md`, phase 2.
- **Damage.** A frame reports which rectangles changed, and the chrome's own
  repaint damages the whole output because the chrome is one layer covering the
  desktop. Acting on damage properly wants a DRM backend and a screen.

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
