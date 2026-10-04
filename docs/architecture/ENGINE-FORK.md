# Engine fork: `<app>` is a `SurfaceLayer`

Domicile forks Chromium so that `<app>` is backed by a `cc::SurfaceLayer`. The
layer embeds a viz surface that `domicile-compositor` submits from a Wayland
client's dmabuf.

- Out-of-process `<iframe>`s and hardware-decoded `<video>` use the same
  mechanism.
- CSS works on an `<app>` the way it works on any element: the page's own
  compositor applies z-index, transform, clip, opacity, filters and blend modes
  to the layer.
- The client's buffer reaches the screen as a texture quad, which viz can
  promote to a hardware overlay.
- The fork is mostly new files, so it is cheap to carry across Chromium
  releases.

Related docs:

- [ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md): the CSS parity,
  latency and dmabuf measurements behind this design.
- [ENGINE-FORK-CHROMIUM-NOTES.md](ENGINE-FORK-CHROMIUM-NOTES.md): Chromium
  behavior found while building it (mojo transport, Rust bindings, Ozone
  platforms and dmabuf import).
- [DOMICILE-SCHEME.md](DOMICILE-SCHEME.md): how the shell page is served and
  reaches the compositor.
- [`packages/domicile-engine/docs/BUILDING-CHROMIUM.md`](/packages/domicile-engine/docs/BUILDING-CHROMIUM.md):
  checking out and building the engine.

## Problem

Chromium does not expose its layer tree. The page reaches the compositor as one
flat raster, so the only way to put a window between page elements is to split
the page into bands. Bands force `data-band` onto every painting element, which
breaks CSS parity and makes shells complicated.
[STACKING-PARITY.md](STACKING-PARITY.md) has the evidence.

## Design

```
  wayland client ──dmabuf──▶ domicile ──CompositorFrame──▶ viz ──┐
                             (viz client)                        │ aggregates
                                                                 ▼
  page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ─┴─▶ display
```

The page and the compositor share only a `viz::SurfaceId`. The page never sees
the window's pixels. The compositor never sees the page's layout.

### The embedder allocates, the producer submits

Chromium embeds out-of-process iframes the same way (`RemoteFrame`,
`third_party/blink/renderer/core/frame/remote_frame.cc`).

- A `SurfaceId` is a `FrameSinkId` plus a `LocalSurfaceId`.
- The page allocates the `LocalSurfaceId`. When the `<app>` box resizes, the
  page bumps `parent_sequence_number` and the client gets a configure with the
  new size.
- The `LocalSurfaceId` carries an `embed_token`, an unguessable token the
  embedder generates. Holding the token is the permission to embed. Viz refuses
  an id whose allocation group does not match its submitter.
- `cc::SurfaceLayer` is an ordinary `cc::Layer`, so it sits in the property
  trees with every other layer. That is what gives CSS parity.

The browser's jobs:

- allocate the producer a `FrameSinkId`
- register the frame-sink hierarchy so `BeginFrame`s flow
- pass ids between the page and the producer

| Id | Supplied by | Why |
|---|---|---|
| `FrameSinkId` | the browser | It is in client id 0, the browser's namespace. Renderers cannot name ids outside their own. |
| `LocalSurfaceId` | the page | The page is the embedder. Its `embed_token` is the capability the producer needs to submit. |

### Brokering a frame sink to a non-renderer

Viz does no authorization: `FrameSinkManagerImpl::CreateCompositorFrameSink`
rejects only a duplicate `FrameSinkId` or a missing bundle. The browser makes
every decision.

- Renderer ids are checked against the renderer's own namespace (its child
  process id, always 1 or more).
- The browser's namespace is `kBrowserClientId = 0`. No renderer can name an id
  in it.
- `content::AllocateFrameSinkId()` and `content::GetHostFrameSinkManager()` are
  exported free functions, so a browser-process service needs no
  `RenderProcessHost`.

- `FrameSinkBroker` (`components/domicile/browser/`) allocates the
  `FrameSinkId` itself, in the browser namespace.
- It uses the browser's injected allocator. A second `FrameSinkIdAllocator(0)`
  would reuse ids.
- Only the named socket below reaches it, because it can allocate any frame
  sink.

### How the producer reaches the broker

- The browser listens on a named socket (`mojo::NamedPlatformChannel`) and
  sends a real mojo invitation. The producer joins the browser's mojo graph.
- The socket path is the access control. Only the user can open it.
- The socket opens at browser startup (patch `0004`, one line in
  `browser_main_loop.cc`). It cannot wait for a page: the page mounts `<app>`
  only after the compositor announces a window, and the compositor is the
  producer that connects over this socket.
- `mojo::IsolatedConnection` does not work here. A process on it cannot forward
  a received handle, and the broker forwards the producer's
  `CompositorFrameSink` receiver to the viz process.

[ENGINE-FORK-CHROMIUM-NOTES.md](ENGINE-FORK-CHROMIUM-NOTES.md#mojo-invitations)
lists two undocumented transport constraints.

### Embedding in the page

`<app app-id="…">` is a real element, `HTMLAppElement` (patch `0007`).

- `LayoutAppSurface::UpdateAfterLayout` reports the box layout gave it.
- `ExternalSurfaceEmbedder` resolves the `SurfaceId` for the app id.
- `SurfaceLayerBridge::EmbedSurface` and `cc::SurfaceLayer::SetSurfaceId` do not
  check which namespace the surface belongs to, so the page embeds a surface it
  did not allocate without changes to either.
- `canvas.embedExternalSurface()` (patch `0002`) does the same embed.
  `spike-page.html`, `spike-iframe-page.html` and `guard-two-windows.html` use
  it.
- A fork element must override `Node::GetElementType`. Without it, casts to
  the element return null and `<app>` never embeds.
  `scripts/test-fork-elements-know-their-type.sh` checks this.

Two mojo interfaces carry the ids, each with one method:

| Interface | Direction | Carries |
|---|---|---|
| `domicile.mojom.ExternalSurfaceProvider` | renderer → browser | The page's `LocalSurfaceId` and size. Returns the `FrameSinkId`. A page naming a surface it was not offered gets an empty one. |
| `domicile.mojom.SurfaceObserver` | browser → producer | A `LocalSurfaceId` and a size, sent again whenever the box changes. |

### One engine, many surfaces

- The compositor opens one socket to the browser and creates one surface per
  window.
- Viz allows only one frame sink per embed token, so each app id gets its own
  `LocalSurfaceId` allocator in the renderer.
- Several elements naming one app show one producer. Different apps get
  different surfaces.
- `third_party/blink/renderer/platform/graphics/external_surface_embedder.h`
  has the details.

### Embed deadlines

- `<app>` embeds with deadline 0 (`SurfaceLayerBridge`), so the page never waits
  for a client to draw.
- A `<webview>` guest also embeds with deadline 0 (patch `0054`). The default
  deadline would make the whole desktop wait on one page's layout during a
  drag or tiling animation.
- An `<iframe>` still uses the default deadline.
- `scripts/test-a-webview-does-not-hold-the-shell.sh` checks this.

## The C ABI

`libdomicile_engine.so` is the seam between the compositor and the browser.

- The library is C++ built by GN. It owns the mojo side: the invitation, the
  `FrameSinkBroker` pipe, the `SharedImage` handoff and `CompositorFrame`
  assembly.
- `domicile-compositor` (Rust) owns the Wayland side.
- The compositor `dlopen`s the library, so `cargo build` needs no Chromium
  checkout. CI has none. If the library fails to load, the compositor refuses
  to start (see [ERRORS.md](/docs/guidelines/ERRORS.md)).
- The library does not own the thread. It exposes a pollable fd, like
  `wl_display_get_fd` / `wl_display_dispatch`. Callbacks fire only inside
  `dispatch`, on the caller's thread:

```c
int  domicile_engine_fd(DomicileEngine*);       // add to calloop
void domicile_engine_dispatch(DomicileEngine*); // run pending work, fire callbacks
```

Each entry maps onto a Wayland request the compositor already handles.

Calls (compositor → engine):

| C ABI | Wayland equivalent |
|---|---|
| `domicile_surface_create(engine, app_id)` → `DomicileSurfaceId` | a window appearing. The page's embed waits for this call. |
| `domicile_surface_import(surface, dmabuf)` → `DomicileBufferId` | `zwp_linux_dmabuf_v1` |
| `domicile_surface_submit_crop(surface, buffer, crop, damage)` | `wl_surface.commit` with `xdg_surface.set_window_geometry` |
| `domicile_displays_configure(layout, count)` | output configuration |
| `domicile_clipboard_set(clipboard, text, length)` | `wl_data_offer.receive`. The compositor sends the selection text it already read. |

Callbacks (engine → compositor):

| C ABI | Wayland equivalent |
|---|---|
| `released(surface, buffer)` | `wl_buffer.release` |
| `frame(surface, deadline_us)` | `wl_surface.frame` |
| `configure(surface, width, height)`, `configure_at(…, scale)` | `xdg_toplevel.configure` |
| `displays(displays, count)` | `wl_output`. Primary first, never empty. |
| `copied(clipboard, text, length)` | `wl_data_device.set_selection` for a copy made in a page |

- Only `crop` fills the `<app>` box, so client-side shadows are not drawn. An
  empty rectangle means the whole buffer or surface. `domicile_surface_submit`
  takes no crop.
- `released` stops the compositor from reusing a buffer viz is still sampling.
- `domicile_engine.h` is the full ABI, including the lifetime calls.

### Buffer import

The browser imports each dmabuf. The producer submits its own frames.

1. `domicile_surface_import` sends the dmabuf fds, DRM fourcc and layout over
   the existing socket.
2. The browser imports it the way `exo::Buffer` does
   (`components/exo/buffer.cc`). That code needs `aura::Env`, which only the
   browser has.
3. The browser returns a `gpu::ExportedSharedImage`: a mailbox, metadata and a
   verified sync token.
4. The producer calls `gpu::ClientSharedImage::ImportUnowned`, builds its own
   `viz::TransferableResource` and submits its own `CompositorFrame`.
5. Viz returns the resource through the producer's own sink, which fires
   `released`.

Decisions:

- **Broker the import over brokering a GPU channel.** A GPU channel
  (`viz.mojom.Gpu`, what a renderer gets) would give an external process
  unrestricted GPU authority and pull the `gpu::` client stack into the
  library. Brokering the import costs one hop per buffer, and buffers are
  imported once and reused.
- **The producer submits its own frames.** It holds `gpu::` and `viz::` types,
  but no GPU channel. A mailbox lets the producer sample an existing image. It
  cannot create new ones. This takes the browser off the per-frame path.
- `ImportBuffer` refuses a DRM fourcc it cannot map. Guessing swaps color
  channels (`ARGB8888` vs `ABGR8888`).

## Key decisions

- **`SurfaceLayer` over `cc::LayerTreeHost` changes.** The alternative was a
  privileged "bind dmabuf to texture" path and per-layer depths in cc. cc
  already draws foreign surfaces for every page with an out-of-process iframe.
- **Domicile stays an external Rust process, not an in-tree `exo`.** exo is
  `assert(is_chromeos)`, depends on `//ash`, `//chromeos/ui/*`, `//ui/aura`,
  `//ui/views` and `//ui/wm`, and is one `static_library` with no separable
  core. Only `buffer.cc` is useful, and the import above ports it into the
  browser.
- **The library is C++ behind a C ABI, not a Rust mojom crate.** Chromium's Rust
  mojo bindings exist but cannot reach a cargo build.
  [ENGINE-FORK-CHROMIUM-NOTES.md](ENGINE-FORK-CHROMIUM-NOTES.md#rust-mojo-bindings)
  has the details.
- **`<app>` is a real element.** Patch `0007` defines `<app>` and `<webview>`,
  at the cost of eleven edited files, many of them generated lists that rebase
  noisily. In return a shell writes a tag with `app-id` reflection and default
  styling, and the SDK supplies only the tag-name map.
- **The browser leaves keys, clicks and credentials to the shell.** See
  [ENGINE-BROWSER-BEHAVIOR.md](ENGINE-BROWSER-BEHAVIOR.md), which also covers
  inhibiting the host's shortcuts when nested.
- **Minimize edited files, not added ones.** New files do not conflict on
  rebase. The generated lists (`runtime_enabled_features.json5`, the `json5`
  name lists, `.gni` bindings lists, `BUILD.gn` source lists) are what
  conflict. Count edited files from the patch headers (see the
  [package README](/packages/domicile-engine/README.md#why-a-patch-series)).

## Plan

Ozone/DRM is tracked in [A-DESKTOP-ON-A-TTY.md](A-DESKTOP-ON-A-TTY.md). Open
items:

- [ ] **shm clients on a GPU.** The compositor copies each shm frame into one
      of its own GBM buffers (`packages/domicile-compositor/src/uploads.rs`)
      and submits it like a dmabuf. This is tested only on llvmpipe; no check
      has a render node.
- [ ] **Presentation, measured.** Every measurement reads pixels from
      a `CopyOutputRequest`. Nothing reads a lit CRTC yet, so overlay
      promotion, damage and the presentation half of latency are unmeasured.

## Open questions

- **Input hit testing.** `SurfaceLayer::SetSurfaceHitTestable` and viz hit
  testing exist, but Domicile routes input itself. Recommendation: keep
  Domicile's routing, with the page reporting the box. Unknown: whether viz's
  hit-test data must agree with Domicile's to keep the engine from swallowing
  events.
- **A compositor restart breaks every embed.** App ids come from a counter that
  restarts with the compositor. After a restart, `app-1` gets a new
  `FrameSinkId`, but the page still holds the old token, and every embed of it
  is refused. `FrameSinkBroker::OnProducerDisconnected` drops the sinks but does
  not tell the renderer. Recommendation: invalidate the renderer's tokens on
  disconnect. This is the first reload case a shell hits.
- **The renderer's parent frame sink is not checked.** `ExternalSurfaceProvider`
  is bound as a free function, so the browser does not verify that the renderer
  owns the parent frame sink it names. `EmbeddedFrameSinkProviderImpl` makes
  that check. Recommendation: bind through `RenderProcessHostImpl` to get the
  renderer's child process id, at the cost of one more edited file.
