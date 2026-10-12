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

## Frame pacing

A client draws its next frame when viz takes its last one, so it draws at the
rate the screen shows it.

- **`wl_surface.frame`:** a commit's callbacks wait for the engine's
  `frame_done`, viz's ack of the frame the commit submitted
  (`frame_callbacks.rs`).
- **`wp_presentation`:** a commit's feedback waits for the engine's
  `presented`, the frame's `FrameTimingDetails` from viz. The clock is
  `CLOCK_MONOTONIC`, synced to the output the window is on. `seq` is always
  zero: viz reports no vblank count.
- **Held frames:** a frame waiting for its buffer's import or for a page to
  embed its window has no number yet. Its commit's callbacks and feedback wait
  by window, and take the number the frame goes up with. A newer frame answers
  them and discards the feedback.
- **Frames viz never sees** answer at once and discard their feedback: an shm
  frame the compositor could not copy, a commit with no new buffer, the
  chrome's own window.
- **The deadline:** a frame the engine does not report within 250 ms is
  answered anyway and its feedback discarded, so no client waits for good.
- **Older engines** lack `domicile_engine_reports_frames`. The compositor
  answers at commit and discards feedback.

## Hidden windows

A window the page does not draw (another workspace, a background tab) draws
about once a second, unless a cast shows it.

- **The page:** reports it with an empty box, `setAppBounds(appId, 0, 0, 0,
  0)`. The engine never says whether an `<app>` is composited.
- **The compositor:** holds the `wl_surface.frame` callbacks of the window,
  its popups and its bubbles (`held_frames.rs`), and sets `xdg_toplevel`'s
  `suspended` state. A box with an area clears `suspended` and sends the held
  callbacks.
- **Not stopped:** held callbacks still go out once a second, and before a
  close. A client blocked in `eglSwapBuffers` reads nothing else until one
  arrives: not a close, and not its other windows' events. At most 16 are
  held per window; a client that commits without waiting gets the oldest
  back.
- **Casts:** a hidden window that a cast shows holds nothing and is not
  suspended, so the cast keeps its frame rate (`HeldFrames::cast`). When its
  last cast ends, it is held and suspended again.
- **A new page** (`hello`) has hidden nothing, so every window is shown.
  Otherwise a shell that never reports boxes would leave them suspended.
- **Cost:** a window shown again can take a frame or two to appear. Its
  client starts its next frame only then. Manganese delays a closing tab's
  fade by as long, so the tab it uncovers is drawn first.
- **Theme changes** do not wait for hidden windows to repaint.

## What CSS does to a window

Anything that works on a hardware-composited `<video>` works on an `<app>`. Both
are the same layer type in the same property trees, so there is no list of
supported properties to maintain.

Measured against an ordinary element laid out beside it, an `<app>` matches
pixel for pixel on the GPU for `z-index`, `transform`, `border-radius`,
`opacity`, `filter: blur()`, `mix-blend-mode` and resize. See
[ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md#css-parity).

## Pre-rotated buffers

A client may draw its buffer turned to match a rotated monitor and say so with
`wl_surface.set_buffer_transform`. The engine turns it upright.

- **Compositor:** sizes the surface by the upright buffer, a quarter turn
  swapping its sides, and maps the window-geometry crop into the buffer's own
  pixels (`buffer_transform.rs`). Both dmabuf and `wl_shm` frames take this
  path; an shm frame is copied unturned (`uploads.rs`).
- **Engine:** `domicile_surface_submit_transformed` draws the quad in the
  buffer's orientation and gives it a `quad_to_target_transform` onto the box
  (`surface_transform.cc`). Viz turns it on the GPU, so no pixel is copied.
- **Older engines** lack the symbol. The compositor submits unturned and logs
  once when a buffer is turned.
- **Casts:** a window cast and a shot of one window turn the frame upright too
  (`Layer::upright` in `casting/gpu.rs`). The CPU copy maps each pixel as
  `buffer_transform.rs` does; the GPU draw gives Smithay the inverse transform,
  which its GLES frame expects. A turned frame's damage is the whole frame.
- **Checks:** `surface_transform_unittest.cc` maps each of the eight transforms
  as Weston does. `guard-buffer-transform.sh` shows a turned shm buffer upright,
  and `e2e-a-window-casts-to-pipewire.sh` casts one upright. No check covers a
  turned dmabuf, because none has a render node.

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
GBM buffer and submits that (`uploads.rs`, `shm_upload.rs`).

- **Checks:** `guard-buffer-transform.sh` drives `domicile-test-client`, a
  `wl_shm` client, on `crux`'s render node (NVIDIA's proprietary driver), and
  finds its pixels on the page. That covers the GBM allocation and the
  browser's import: shm frames have no other path, and without a GBM device the
  window stays blank (`ShmRefused`). The copy is also tested on llvmpipe.
  - Untested on Mesa (AMD, Intel).
- The pixels pass through a texture kept on the surface. While it holds the
  previous commit in the same format, only the client's damage is uploaded.
  Smithay keeps a cached texture's format, so a new format at the same size
  skips the cache.
- **The copy is fenced, not waited for.** The compositor submits with the
  draw's sync_file (`domicile_surface_submit_fenced`). The browser gives the
  fence to the SharedImage (`FenceBuffer`, `UpdateSharedImage`) and returns a
  sync token, which the engine puts on the frame's resource. Viz waits on the
  token, and the GPU waits on the fence before the read.
  - The engine holds the surface's later submits behind a fenced one
    (`surface_submits.cc`), so frames reach viz in commit order.
  - Each fenced frame costs the browser one synchronous flush to the GPU
    process, to verify the token. Viz refuses an unverified one, and the
    engine has no GPU channel to verify it.
  - A refused fence drops the frame and releases the buffer.
- **The copy waits for the GPU on the Wayland thread** with an older engine,
  or a driver that cannot export a sync_file (no
  `EGL_ANDROID_native_fence_sync`).
- Unverified: a GPU process without `EGL_ANDROID_native_fence_sync` skips the
  fence's wait (`GLTexturePassthroughOzoneImageRepresentation::BeginAccess`),
  as for exo, and may show an unfinished copy. No check reads a lit screen,
  so torn shm frames on hardware are unmeasured.

### Damage

The submit takes a damage rectangle in box pixels, where empty means the whole
box. `engine_damage.rs` maps the client's damage onto the box when the engine
shows the window's previous commit at the same box, from the same crop of a
buffer of the same size, and nothing turns or scales either commit's buffer. Where the crop
is stretched to another size, the damage grows a texel each way for the
engine's filtering. Every other commit damages the whole box, as do popups and
bubbles, whose box size the compositor does not know.

Unverified on a screen: a wrong rectangle leaves stale pixels, and no check
reads a lit CRTC ([ENGINE-FORK.md](ENGINE-FORK.md#plan)).
