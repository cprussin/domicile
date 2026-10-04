# Engine fork: Chromium notes

Chromium behavior found while building [ENGINE-FORK.md](ENGINE-FORK.md). None
of it is documented upstream.

## Mojo invitations

The producer joins the browser's mojo graph with
`NamedPlatformChannel::ConnectToServer` and `IncomingInvitation::Accept`. The browser sends with
`OutgoingInvitation::Send(invitation, target, server_endpoint)`.

- **`base::kNullProcessHandle` works on Linux.** `Send` asks for the target's
  process handle "if known" and warns IPC is limited without it on Mac and
  Windows. A process the browser did not launch has no handle. Linux loses
  nothing.
- **Name invitation pipes with small integers.** ipcz indexes an attachment by
  the first four bytes of its name as a little-endian integer. A name that is
  not exactly 4 or 8 bytes long maps to index 0
  (`mojo/core/ipcz_driver/invitation.cc`, `GetAttachmentIndex`). Two
  string-named pipes collide, and the second `AttachMessagePipe` fails a
  `DCHECK` with `MOJO_RESULT_ALREADY_EXISTS`. The limit is
  `Invitation::kMaxAttachments` (7).

## Rust mojo bindings

Chromium has Rust mojo bindings (`mojo/public/rust`). A `mojom()` GN target can
emit a `_rust` crate with a real `CompositorFrameSink` trait. A cargo build
cannot use them:

1. **`generate_rust` spreads.** It is opt-in per `mojom()` target and marked
   "under development". Enabling it for `//services/viz/public/mojom` requires
   enabling it for every import: 24 mojom targets across 14 Chromium `BUILD.gn`
   files, plus one `visibility` list. The fork's design edits 21 files in
   total.
2. **The generator fails on the viz graph.** 50 crates build, then
   `media/mojo/mojom:media_types` fails: `media.mojom.StatusData` contains
   itself, and the generator emits a direct `Option<StatusData>` field
   (`error[E0072]: recursive type has infinite size`). `CompositorFrame`
   depends on it. The `surfaces` subset (`FrameSinkId`, `LocalSurfaceId`)
   builds.
3. **The runtime needs Chromium's C++.** `mojo/public/rust/system` depends on
   `//base` and `cxx_bindings`. `c_mojo_api` is `rust_bindgen` over
   `mojo/public/c/system/thunks.h`. Using a mojom crate from cargo means
   linking `//base` and mojo core, which are GN artifacts.

So the engine library is built by GN and exposed through a C ABI.

## Ozone platforms and dmabuf import

A dmabuf becomes a `SharedImage` through
`SurfaceFactoryOzone::CreateNativePixmapFromHandle`.

| Implements it | Does not |
|---|---|
| `drm` (gbm), `wayland`, `x11`, `flatland` | `headless` |

`HeadlessSurfaceFactory::CreateNativePixmap` returns a `TestPixmap` stub and
does not override `CreateNativePixmapFromHandle`. Under
`--ozone-platform=headless`, every dmabuf import fails.

`packages/domicile-engine/scripts/under-wayland.sh` runs the engine with
`--ozone-platform=wayland`, nested in a headless wlroots compositor, on the
GPU. Every gate in `WaylandBufferManagerGpu::GetGbmDevice()` passes on `crux`:

| Gate | Status |
|---|---|
| `use_wayland_gbm` | `true` in the build |
| host advertises `zwp_linux_dmabuf_v1` | sway yes, weston no |
| `EGL_EXT_image_dma_buf_import` | yes, NVIDIA's EGL lists it and `..._modifiers` |
| a GBM backend for the device | yes, NVIDIA ships `nvidia-drm_gbm.so` |
| `gbm_create_device()` on the render node | succeeds on `/dev/dri/renderD128`; GL initializes with `EGL_PLATFORM_GBM_KHR` |

- Chromium's GBM path does not need Mesa.
- Use a wlroots host, not weston. Weston's headless backend advertises only
  `wl_shm`, and `GetGbmDevice()` returns null unless the host supports dmabuf.
  wlroots builds a renderer on the render node even with no screen, so it
  advertises dmabuf.
- The pixel checks that locate the viewport by scanning for a full-width row of
  the page background stay on `headless`. Under Wayland the browser window has
  client-side decorations and a shadow, so no row qualifies.

## Running on the GPU

`crux` has an NVIDIA GTX 970 (driver 580.173.02), render node
`/dev/dri/renderD128`, and no connected display. Chromium reports `ANGLE
(NVIDIA Corporation, NVIDIA GeForce GTX 970/PCIe/SSE2, OpenGL ES 3.2)`.

- ANGLE `dlopen`s glvnd's `libEGL.so.1`. Chromium's toolchain shell does not
  provide it, and NixOS keeps vendor libraries in `/run/opengl-driver/lib`. So
  the engine falls back to software unless the library path is set.
- `GPU=1` on the spike scripts sets the path.
- `scripts/e2e-dmabuf.sh` passes on `crux`.

## `SurfaceLayerBridge` vs the OOPIF path

An OOPIF differs from a `<div>` by 255 edge pixels under `transform`; an
`<app>` does not
([measurements](ENGINE-FORK-MEASUREMENTS.md#app-compared-to-an-out-of-process-iframe)).
These differences between the two layer setups do not explain it:

- `SurfaceLayerBridge::CreateSurfaceLayer` sets `SetStretchContentToFillBounds`.
  It changes the `SurfaceAggregator` branch for content scale
  (`surface_aggregator.cc`), but both branches compute 1.0 when the surface
  matches its box, which it always does here.
- `SetOverrideChildPaintFlags(bool)` writes `true` whatever it is passed
  (`cc/layers/surface_layer.cc`). This is an upstream bug; see
  `packages/domicile-engine/upstream/setoverridechildpaintflags.md`.
- Setting `SetMasksToBounds(true)` on an attached layer in layer-list mode
  fails `DCHECK(!IsAttached() || !IsUsingLayerLists())` and crashes the
  renderer.

## Backdrop filters and overlay promotion

At the pin, viz does not promote a quad to an overlay when a backdrop filter
reads it ([WINDOW-COMPOSITING.md](WINDOW-COMPOSITING.md#backdrop-filter-over-a-window)):

- `OverlayCandidateFactory::IsOccludedByFilteredQuad`
  (`components/viz/service/display/overlay_candidate_factory.cc:280`) treats a
  quad as occluded when an `AggregatedRenderPassDrawQuad` above it has
  non-empty `backdrop_filters`.
- `OverlayStrategyUnderlay` (`overlay_strategy_underlay.cc:61`) skips such a
  candidate.
- `OverlayStrategySingleOnTop` rejects any candidate overlapped by an earlier
  visible quad.
- Exception: a quad with `requires_overlay` (protected content) is promoted
  under a filter anyway.
