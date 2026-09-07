# Forking the engine: `<app>` is a `SurfaceLayer`

Fork Chromium and back `<app>` with a **`cc::SurfaceLayer`** that embeds a viz
surface `domicile-compositor` submits from the client's dmabuf. That is the
mechanism an out-of-process `<iframe>` and a hardware-decoded `<video>` already
use, so CSS is **structural rather than reimplemented** — z-index, transform,
clip, opacity, filter, blend modes are applied by the page's own compositor to
a layer like any other — and the client's buffer reaches the screen as a
texture quad viz can promote to a hardware overlay.

The seam already exists and is load-bearing in shipping Chromium. The fork is
mostly **new files**, which is what makes it affordable to carry.

## Problem

`docs/architecture/STACKING-PARITY.md` has the evidence. In one line: the
engine will not emit its layer tree, so the page arrives as one flat raster,
and the only way to interleave a window into it is bands — which impose
`data-band` on every painting element and so fail both the CSS-parity and the
shell-simplicity requirements.

## Design

```
  wayland client ──dmabuf──▶ domicile ──CompositorFrame──▶ viz ──┐
                             (viz client)                        │ aggregates
                                                                 ▼
  page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ─┴─▶ display
```

The page and the compositor meet at a `viz::SurfaceId` and nowhere else. The
page never sees a pixel of the window; the compositor never sees the page's
layout.

**The embedder allocates, the producer adopts.** This is not our invention —
it is what `RemoteFrame` does for every OOPIF today
(`third_party/blink/renderer/core/frame/remote_frame.cc:1004`):

```cpp
viz::SurfaceId surface_id(frame_sink_id_,
                          pending_visual_properties_.local_surface_id);
compositing_helper_->SetSurfaceId(surface_id, allow_paint_holding);
```

The embedding side bumps a `LocalSurfaceId` whenever its box changes and the
producer renders to it. That maps exactly onto a compositor telling a client to
resize: the `<app>` element's layout box *is* the `xdg_toplevel.configure`.
It is even the same two-writer id — `parent_sequence_number` is the embedder's
to increment, `child_sequence_number` the producer's
(`components/viz/common/surfaces/local_surface_id.h:50`).

**Authorization is a capability, not an ACL**, which is what makes the
brokering small. A `LocalSurfaceId` carries an `embed_token`, an
`UnguessableToken` the *embedder* generates, and the same header says why:

> The purpose of this value is to make SurfaceIds unguessable, because
> FrameSinkIds and LocalSurfaceIds are otherwise predictable and clients might
> exploit this fact to embed surfaces they're not allowed to.

So nothing has to decide whether the page *may* embed a window. Holding the
token is the permission, the page mints it, and viz refuses an id whose
allocation group does not match its submitter. The browser's remaining job is
narrow: allocate Domicile a `FrameSinkId`, register the frame-sink hierarchy so
`BeginFrame`s flow, and carry the id between the two.

And the embedding itself, whole, from `child_frame_compositing_helper.cc:60`:

```cpp
surface_layer_ = cc::SurfaceLayer::Create();
surface_layer_->SetSurfaceId(surface_id, cc::DeadlinePolicy::UseDefaultDeadline());
child_frame_compositor_->SetCcLayer(surface_layer_, /*is_surface_layer=*/true);
```

`cc::SurfaceLayer` is a plain `cc::Layer` — "a layer that renders a surface
referencing the output of another compositor instance or client"
(`cc/layers/surface_layer.h:36`). It goes into the property trees with every
other layer, which is the whole of requirement 2.

### Who may create a frame sink

**Nobody, at the viz layer.** `FrameSinkManagerImpl::CreateCompositorFrameSink`
(`components/viz/service/frame_sinks/frame_sink_manager_impl.cc:333`) rejects a
duplicate `FrameSinkId` and a nonexistent bundle, and checks nothing else. Every
authorization decision is the browser's.

The check the renderer path makes is **namespace ownership, not privilege**:

```cpp
if (frame_sink_id.client_id() != renderer_client_id_) {
  receivers_.ReportBadMessage("Invalid client ID");
```

`renderer_client_id_` is the renderer's own child process id
(`render_process_host_impl.cc:2783`), so this says *you may name only ids in the
namespace I gave you* — the browser refusing a renderer's claim on someone
else's sinks. It is not a gate the browser must get past.

The browser has a namespace of its own, and it is unreachable by any renderer:

| | |
|---|---|
| browser | `kBrowserClientId = 0` (`viz_process_transport_factory.cc:68`) |
| renderer | its `ChildProcessId`, which "starts generating id's at 1" and treats 0 as invalid (`content/public/common/child_process_id.h:15`) |

And both halves of the privilege are `CONTENT_EXPORT` free functions —
`content::AllocateFrameSinkId()` and `content::GetHostFrameSinkManager()`,
`content/browser/compositor/surface_utils.h:19` — so a browser-process service
needs no `RenderProcessHost` and no renderer to hold one. And
`mojom::CompositorFrameSink` is an ordinary message pipe once created, so it
goes wherever a pipe can go.

So the broker inverts the renderer interface: instead of validating an id the
caller supplies, it allocates one and returns it. The allocator is injected
rather than private, because a second `FrameSinkIdAllocator(0)` would hand out
ids the browser has already used.

### How the producer reaches the broker

One of the two obvious answers is disqualified rather than merely worse.

**`mojo::IsolatedConnection` cannot be used.** It is the natural fit on paper —
"primarily useful when you already have two established Mojo process graphs
isolated from each other" — but its own header states the disqualifying
limitation:

> if one of the processes sends a Mojo handle (e.g. another message pipe
> endpoint) to the other process, the receiving process cannot pass that handle
> to yet another process in its own graph.

Forwarding is the broker's entire job. The producer sends a
`PendingReceiver<CompositorFrameSink>`, and
`HostFrameSinkManager::CreateCompositorFrameSink` passes it straight to
`frame_sink_manager_`, a remote to **the viz process**
(`host_frame_sink_manager.cc:221`). That is exactly the hop the limitation
forbids.

**So it is a real invitation over a named socket, and it works.**
`mojo::NamedPlatformChannel` gives a `PlatformChannelServerEndpoint`, and
`OutgoingInvitation::Send(invitation, target, server_endpoint)`
(`invitation.h:103`) accepts one. The producer joins the browser's mojo graph,
so handles route anywhere in it — including the one hop that matters, the
`CompositorFrameSink` receiver the broker forwards to the viz process. This
also settles the access-control question in the same stroke: the socket path
*is* the ACL.

The producer is `components/domicile/spike/solid_color_submitter.cc`, a process
the browser did not launch, does not sandbox, and has no `RenderProcessHost`
for. It connects with `NamedPlatformChannel::ConnectToServer` and
`IncomingInvitation::Accept`, and gets back `FrameSinkId(0, 2)` — client id 0,
the browser's own namespace, the one no renderer can name.

Two constraints on the transport, neither of them documented upstream:

- **`base::kNullProcessHandle` is fine on POSIX.** `Send` wants the target
  process handle "if known", and warns that IPC is limited without it on Mac and
  Windows. There is no handle for a process you did not launch, and on Linux
  nothing was lost.
- **Pipe names on an invitation must be small integers, not strings.** Under
  ipcz an attachment is indexed by the first four bytes of its name read as a
  little-endian integer, and a name that is not exactly 4 or 8 bytes long lands
  on index 0 (`mojo/core/ipcz_driver/invitation.cc`, `GetAttachmentIndex`). Two
  string-named pipes on one invitation therefore collide, and the second
  `AttachMessagePipe` fails a `DCHECK` with `MOJO_RESULT_ALREADY_EXISTS`. The
  cap is `Invitation::kMaxAttachments`, which is 7.

### What it takes to get a surface on the screen

Not killed. **Registering the frame sink and registering the hierarchy do
different jobs, and neither of them is what draws the surface.** Each of the
embedder's three jobs was switched off in turn
(`--domicile-spike-skip-hierarchy`, `--domicile-spike-skip-surface-layer`):

| | | |
|---|---|---|
| | BeginFrames | aggregated |
| hierarchy + `SurfaceLayer` | yes | **yes** — drew `#FFFF00FF`, the colour submitted |
| `SurfaceLayer` only | **no** | **yes** — the frame submitted with a manual `BeginFrameAck` was still drawn |
| hierarchy only | yes | no — nothing named the `SurfaceId`, so there was nothing to draw |

`RegisterFrameSinkHierarchy` is about **BeginFrames**: a producer that does not
need viz to drive it can skip it and still get pixels on screen. Aggregation
needs an **embedder naming the `SurfaceId` in a `SurfaceDrawQuad`** — the
design's `cc::SurfaceLayer`, which step 3 moved from the browser's UI into the
page.

The proof is a pixel, not a log line. The embedder issues a `CopyOutputRequest`
on the embedding layer, which viz answers out of the display compositor's draw
*after* the aggregator has resolved the `SurfaceDrawQuad`, and hands the centre
pixel back to the producer over mojo; the producer compares it to what it
submitted and sets its exit code. `--color=FF00C853` returns `#FF00C853`, so
the pixel is the producer's rather than the fallback — which is black, and set
so for that reason.

### Whether the page will embed a surface it did not allocate

Not killed, and nothing had to be persuaded. Neither layer looks at whose
surface it is:

| | |
|---|---|
| `SurfaceLayerBridge::EmbedSurface` | takes a `SurfaceId` and never compares it to its own `frame_sink_id_` (`surface_layer_bridge.cc:58`). Only `SetLocalSurfaceId`, the mojo path an OffscreenCanvas uses, pins the id to the bridge's own sink |
| `cc::SurfaceLayer::SetSurfaceId` | stores a `SurfaceRange` and checks nothing about the `FrameSinkId`'s namespace (`surface_layer.cc:52`) |

So `canvas.embedExternalSurface()` is `HTMLCanvasElement::CreateLayer()` — what
`transferControlToOffscreen` already calls — followed by `EmbedSurface()` with
an id that came from the browser. `HTMLCanvasPainter::PaintReplaced` then
records that layer with
`RecordForeignLayer(..., DisplayItem::kForeignLayerCanvas, ...)`
(`html_canvas_painter.cc:87`), which is the mechanism behind requirement 2: the
page's own property trees apply to it, because it is in them.

The proof is the same pixel as step 2, read through the page instead of the
browser's window:

```
$ ... scripts/spike.sh /build/chromium/src -- --color=FF00C853
brokered frame sink: FrameSinkId(0, 2)
waiting for a page to embed it...
a page embedded us: LocalSurfaceId(1, 1, E8F6...) at 1024x681
BeginFrames are flowing
aggregated: drew #FF00C853, submitted #FF00C853
```

`1024x681` is the canvas's layout box — the viewport, since the page's canvas
fills it — and not its `width` and `height` attributes. That is the claim the
design rests a resize on, so the size the producer is configured at is read off
the box rather than the attributes.

And the control that makes it a fact rather than a coincidence — the same page
and the same producer, with the canvas shrunk to 16px in the corner so that the
sample lands beside it rather than on it:

```
NOT aggregated: drew #FF3F51B5, submitted #FF00C853
```

`#3F51B5` is the page's own background. CSS moved the canvas and the producer's
surface moved with it. That is the first evidence for requirement 2 that is
measured rather than read off the mechanism, and it is two properties out of
the seven step 4 has to cover.

**The ids meet in the middle, and neither side could supply the other's half.**

| | | |
|---|---|---|
| `FrameSinkId` | the browser | a brokered id is `client_id 0`, and every `EmbeddedFrameSinkProvider` entry point rejects an id whose client id is not the calling renderer's. The renderer cannot name one |
| `LocalSurfaceId` | the page | it is the embedder, and the `embed_token` in it is the capability the producer needs to submit. Bumping `parent_sequence_number` is how it will resize the producer |

Two new interfaces carry that, both narrow on purpose:

| | |
|---|---|
| `domicile.mojom.ExternalSurfaceProvider` | renderer → browser, one method. A page says which `LocalSurfaceId` it allocated and how much it will show, and is told the `FrameSinkId`. It grants rather than takes: a page naming a surface it was not offered gets an empty one, because it allocated the id and no producer is submitting to it |
| `domicile.mojom.SurfaceObserver` | browser → producer, one method. The other direction of the same exchange, and the shape `xdg_toplevel.configure` needs: a `LocalSurfaceId` and a size, again whenever the embedder's box changes |

`FrameSinkBroker` stays reachable only over the named socket. Holding that pipe
is unrestricted authority to allocate frame sinks in viz, and no renderer holds
it.

**The reply waits for a producer.** An `<app>` element exists before the client
window behind it does, so a page that embeds early is held rather than failed,
and is answered when a producer connects.

**The socket opens at browser startup**, from one line in
`browser_main_loop.cc`. It cannot wait for a page to ask: a shell's page mounts
an `<app>` element only once the host announces a window, the host learns of
windows from the compositor, and the compositor is the producer that connects
over that socket.

One thing binding it from a free function costs, and it is worth stating rather
than discovering later: **the browser does not check that the renderer owns the
parent frame sink it names.** That is the check
`EmbeddedFrameSinkProviderImpl` makes against its `renderer_client_id_`, and
making it needs the calling renderer's child process id, which means binding
`ExternalSurfaceProvider` through `RenderProcessHostImpl` rather than as a free
function. The cost is one more edited file, and it is not a spike's to pay.

### What CSS does to an `<app>`

Nothing it does not do to a `<div>`. Each property is applied to an `<app>` and
to an ordinary element laid out identically beside it, so the question is
whether one half of a cell is a pixel-for-pixel copy of the other half —
a comparison rather than a judgement. `scripts/spike-step4.sh`, 53,200 pixels
per cell, and the same numbers to the pixel on every run:

| | differing | interior | worst Δ | |
|---|---|---|---|---|
| `z-index` | 0 | 0 | 0 | **exact** |
| `border-radius` | 0 | 0 | 1 | exact |
| `opacity` | 0 | 0 | 2 | exact |
| `filter: blur()` | 0 | 0 | 1 | exact |
| `mix-blend-mode` | 0 | 0 | 1 | exact |
| resize | 0 | 0 | 1 | exact |
| `transform` | 285 | **0** | 84 | edges only |
| *negative control* | 10,800 | 9,976 | 255 | *differs, as it must* |

**`z-index` is the row the fork exists for**, and it is the one with no
difference at all: an `<app>` with `z-index: 1` paints above an ordinary
element at `0` and below one at `2`, with both of them *after* it in document
order so that document order alone would not have put it there. Bands failed
exactly here.

**`transform`'s 285 pixels were software rasterisation, not the mechanism.**
The table above is `--disable-gpu`, which every measurement in this project was
until phase 1 found that `crux` has a GPU. On the GPU, with nothing else
changed, **every cell is 0** — `transform` included, and resize with it:

| | differ | interior | worst Δ |
|---|---|---|---|
| all seven properties | **0** | 0 | 0–3 |

So an `<app>` is not "a `<div>` up to a one-pixel outline"; it is a `<div>`.
The outline was two software raster passes disagreeing in the last bit, and it
is gone on the hardware a user would have. `GPU=1 scripts/spike-step4.sh` is
that run.

Two things stop this from passing for the wrong reason. Each property cell is
also compared against the baseline cell, and a cell whose property never took
effect — a class that did not match, a stylesheet that did not load — leaves
both halves plain, and two plain halves match; the run fails unless every
property visibly changed its cell. And the last cell's control is a colour the
producer never submits, so a diff that cannot see a difference fails there.

### Whether an `<app>` is an out-of-process `<iframe>`

**No, and it does not need to be.** The claim in the row above — that an `<app>`
differs from a `<div>` only the way any surface-backed element does, an OOPIF
included — was read off `child_frame_compositing_helper.cc` and never measured.
Measured, on the GPU, under the same `transform`, with a cross-site `<iframe>`
in a renderer of its own (`scripts/spike-iframe.sh`, 7 renderer processes at
peak):

| | differ | interior | worst Δ | |
|---|---|---|---|---|
| `<app>` vs `<div>` | **0** | 0 | 0 | the requirement, met exactly |
| `<app>` vs OOPIF | 255 | 0 | 52 | not a requirement |
| OOPIF vs `<div>` | 255 | 0 | 52 | Chromium's own embedder is not pixel-exact |

The argument was wrong and the conclusion is better than the argument. An
`<app>` is pixel-identical to an ordinary element; **the OOPIF is the one that
is not**, and it differs from an `<app>` and from a `<div>` by the same 255
edge pixels. So "as good as an `<iframe>`" was the wrong bar — this clears it
and then clears the real one, which is the requirement's own wording: no CSS
behaves differently for an `<app>` than for any other element.

The third row is what keeps the first honest. If an OOPIF ever matched a `<div>`
exactly, the iframe would not be out of process, and all three rows would be
comparing an `<app>` against `<div>`s.

Two differences between the call sites were found and are *not* the cause,
recorded so the next person does not re-derive them.
`SurfaceLayerBridge::CreateSurfaceLayer` sets `SetStretchContentToFillBounds`
and `SetOverrideChildPaintFlags`, and the OOPIF path sets neither. Stretching
changes which branch `SurfaceAggregator` takes for content scale
(`surface_aggregator.cc:857`) but computes 1.0 either way when the surface is
the size of its box, which it is by construction here. And
`SetOverrideChildPaintFlags(bool)` **writes `true` whatever it is passed**
(`cc/layers/surface_layer.cc:138`), so a layer the bridge built cannot have it
unset — upstream's bug, and the one configuration difference that cannot be
closed from outside. Matching the OOPIF's `SetMasksToBounds(true)` is also not
available after the fact: on an attached layer in layer-list mode it fails
`DCHECK(!IsAttached() || !IsUsingLayerLists())`, which is a renderer crash
rather than a difference in a pixel.

### What it costs



One display frame — which is what it costs to ask the question at all.

The producer changes the colour it is submitting and then polls the browser for
the pixel where the page put the `<app>`, until that pixel is the new colour.
Sixty rounds of it, against sixty rounds of the same poll with nothing changed:

| | |
|---|---|
| display frame interval, from viz's own `BeginFrameArgs` | **16.67 ms** |
| poll round trip, nothing changed | median 16.67 ms, **1.0 frames** |
| submit to the new colour being in the display compositor's output | median 16.68 ms, **1.0 frames** |
| draws the new colour took to appear | **1**, on 60 of 60 rounds |

The two distributions are indistinguishable, and that is the result: a frame
from a process outside the renderer is aggregated into the same display frame
as the page around it, with no stage of its own. On a busy machine both numbers
move together to 2.0 frames, which is the measurement's own noise rather than
the producer's.

**This is not latency parity with a plain Wayland compositor, and it cannot be
measured on `crux`.** There is no display server, no GPU and no compositor to
compare against — `--ozone-platform=headless` and `--disable-gpu` are why the
spike runs at all. What the number does establish is the thing the design
claims structurally: no readback, no socket, no extra composite, no frame held
for a stage of its own. What it does not touch is presentation: everything here
is measured out of a `CopyOutputRequest` that forces the draw it then reads,
which is the only way to see what the display compositor drew and is itself the
16.67 ms.

### Rust: the bindings exist, the crate is not the seam

**Chromium ships first-party Rust mojo bindings.** `mojo/public/rust` has three
layers — safe wrappers over the C API, a system layer, and a bindings layer
"directly analogous to the C++ Bindings API" — and a `mojom()` GN target emits a
`_rust` crate beside its C++ one. Turning it on for viz and generating the
crate produces exactly what an external producer would want:

```rust
pub trait CompositorFrameSink : bindings::interface::internal::ImplementThisViaMacro {
  fn SetNeedsBeginFrame(&mut self, needs_begin_frame: bool) where Self: Sized;
  fn SubmitCompositorFrame(&mut self,
      local_surface_id: services_viz_public_mojom_surfaces_rust::local_surface_id::LocalSurfaceId,
      frame: crate::compositor_frame::CompositorFrame,
      hit_test_region_list: Option<crate::hit_test_region_list::HitTestRegionList>,
      submit_time: u64) where Self: Sized;
  ...
}
```

A real `Remote`, real structs, no FFI at the call site — and not reachable from
a cargo build, for three reasons, measured in that order:

1. **`generate_rust` is off by default and transitively viral.** It is opt-in
   per `mojom()` target and documented "under development". Turning it on for
   `//services/viz/public/mojom` means turning it on for every mojom it imports,
   transitively: **24 mojom targets across 14 `BUILD.gn` files Chromium owns**,
   plus one `visibility` list to widen. Against a design whose whole carrying
   argument is "roughly four edited files", that is the number that matters.
2. **The generator does not yet survive the viz graph.** With all 24 enabled,
   GN resolves and 50 crates build, then `media/mojo/mojom:media_types` fails
   to compile: the generator emits `media.mojom.StatusData`, which contains
   itself, as a Rust struct with a direct `Option<StatusData>` field —
   `error[E0072]: recursive type has infinite size`. Upstream's bug rather than
   ours, but `CompositorFrame` is downstream of it. The `surfaces` subset
   (`FrameSinkId`, `LocalSurfaceId`) builds fine.
3. **The Rust runtime is bound to Chromium's C++.** `mojo/public/rust/system`
   depends on `//base` and declares `cxx_bindings`, and `c_mojo_api` is
   `rust_bindgen` over `mojo/public/c/system/thunks.h`. So a mojom crate is not
   a leaf: consuming one from cargo means linking `//base` and mojo core, which
   are GN artifacts. The `chromium::import!` mangling is the *easy* part — it is
   `{target}_{first 8 hex of SHA256 of the GN dir}`, deterministic, and a cargo
   build could pass matching `--extern` flags.

**The conclusion is not "Rust is out", it is "the seam is not the crate".** An
external Rust producer would have to consume a GN-built artifact one way or
another. The honest options are: build the mojo-facing layer in-tree with GN and
expose a C ABI to cargo; or keep the producer's mojo half in C++, as step 2's
throwaway does, and give it the same C ABI. Either way the boundary is a linked
library, not a crate — and neither is blocked, so the recommendation to keep
`domicile-compositor` external stands. What changed is that the cost is now
known and it is a build-system cost, not a language one.

### The pieces

| Piece | Where | New or edited |
|---|---|---|
| Wayland server, input, seat, outputs, session | `domicile-compositor` as it stands | **kept** |
| dmabuf → `gpu::SharedImageInterface::CreateSharedImage` → `viz::TransferableResource` | ported from `components/exo/buffer.cc` | new |
| Submitting `CompositorFrame`s for a sink | new external viz client | **proven** — step 2's throwaway submits from a process the browser never launched and viz aggregates it |
| Brokering a `FrameSinkId` and sink to a non-renderer process | `components/domicile/`, modelled on `content/browser/renderer_host/embedded_frame_sink_provider_impl.cc` | **done** — new files + 4 lines across two `BUILD.gn`. Not `render_process_host_impl_receiver_bindings.cc` as first guessed: nothing about it hangs off a `RenderProcessHost` |
| Getting the producer to the broker | `mojo::NamedPlatformChannel` + a real invitation | **done** — see *How the producer reaches the broker*. One edited file: the socket opens at browser startup, because a shell's page cannot embed until a window exists and no window exists until a producer has connected over it |
| Pushing the `SurfaceId` to the page | `components/domicile/mojom/external_surface.mojom`, modelled on the `RemoteFrame` path | **done** — new files, plus one binder line in `render_process_host_impl_receiver_bindings.cc` |
| An element that embeds it | `HTMLCanvasElement`, which already owns a `SurfaceLayerBridge` and a `cc::SurfaceLayer` for `transferControlToOffscreen` | **done** — `canvas.embedExternalSurface()`, 2 files + IDL as guessed, plus the flag and one `BUILD.gn` |

## Why this meets the requirements

| Requirement | How |
|---|---|
| **Latency parity** | The client's dmabuf becomes a `SharedImage` and rides in a texture quad. Viz aggregates it into the display frame — the same single composite any Wayland compositor does — and its `OverlayProcessor` can promote the quad to direct scanout. No readback, no socket, no `putImageData`. **Measured** as far as `crux` allows: one display frame, indistinguishable from the probe's own floor. See *What it costs* |
| **CSS parity** | The window is a `cc::Layer`. Whatever CSS works on a hardware-composited `<video>` works, because it is the same layer type through the same property trees. This is the requirement's own wording — "just like a `<webview>` or `<iframe>` or `<video>`" — met by using literally that mechanism. **Measured on a GPU: seven properties, every one bit-exact against an ordinary element**, and an `<app>` is closer to a `<div>` than an out-of-process `<iframe>` is. See *What CSS does to an `<app>`* and *Whether an `<app>` is an out-of-process `<iframe>`* |
| **Shell simplicity** | `<app>` stays a custom element wrapping a `<canvas>`, which is what `<domicile-app>` already is. What changes is what fills the canvas, not what a shell author writes |

The third row is the surprise: the shell-side API barely moves. The SDK keeps
its custom element and loses the `AppFrame` plumbing behind it.

## Key decisions

- **`SurfaceLayer` over `cc::LayerTreeHost` surgery.** The old fallback plan was
  to patch a privileged "bind dmabuf → texture" into the engine and teach cc
  about per-layer depths. Embedding a surface needs neither: cc already draws
  foreign surfaces, in production, on every page with an OOPIF.
- **Domicile stays an external Rust process.** Not an in-tree `exo`. exo is
  `assert(is_chromeos)` in `components/exo/BUILD.gn` and depends on `//ash`,
  `//ash/keyboard/ui`, `//chromeos/ui/*`, `//ui/aura`, `//ui/views`, `//ui/wm`,
  with the coupling reaching into `surface.cc` and `surface_tree_host.cc` —
  and there is a single `static_library("exo")` target, so there is no core to
  lift. What we want from it is `buffer.cc`, whose only ChromeOS dependency is
  two calls to `aura::Env::GetInstance()->context_factory()`.
- **Reuse `<canvas>`'s layer rather than adding an element.** A new HTML element
  costs edits to `html_tag_names.json5`, `runtime_enabled_features.json5` and
  the element factory — generated lists that rebase noisily every release.
  `HTMLCanvasElement` already creates a `cc::SurfaceLayer` and already handles
  its sizing, opacity and attachment; one method behind a runtime flag points
  it at a browser-brokered `SurfaceId` instead of an OffscreenCanvas
  placeholder.
- **Minimise edited files, not added ones.** A fork's carrying cost is conflicts,
  and new files do not conflict. "Roughly four places" was the estimate before
  the page half existed; measured, with steps 1–3 landed, it is **nine**, five
  of them Blink's:

  | | |
  |---|---|
  | `components/BUILD.gn`, `content/browser/BUILD.gn` | source lists and deps |
  | `content/browser/browser_main_loop.cc` | one call, opening the producer's socket at startup |
  | `content/browser/renderer_host/render_process_host_impl_receiver_bindings.cc` | one `AddUIThreadInterface` beside the one for `EmbeddedFrameSinkProvider` |
  | `third_party/blink/renderer/core/html/canvas/html_canvas_element.{h,cc,idl}` | the method |
  | `third_party/blink/renderer/platform/runtime_enabled_features.json5` | the flag |
  | `third_party/blink/renderer/platform/BUILD.gn` | the new file and its mojom dep |

  Everything else is additive, and the two that rebase noisily are the
  generated lists — `runtime_enabled_features.json5` and the two `BUILD.gn`
  source lists. Avoiding a new HTML element bought exactly what it was supposed
  to: one entry in one generated list instead of three.

## What gets scrapped

The user's "if this means we need to completely scrap domicile in its current
form, that is acceptable" is taken up, but the bill is smaller than that:

| Gone | Why |
|---|---|
| Bands — `compositor/src/bands.rs`, `shell-manganese/src/bands.ts`, `protocol/src/band_label.rs`, `declare_bands`/`render_band`, `e2e-bands.sh` | Stacking is the layer tree's job |
| The copy path — readback, `AppFrame`, `putImageData` | There is one path and it is zero-copy |
| `place_portal`'s matrix, and the per-frame `requestAnimationFrame` measure loop | Layout positions the layer. The page stops reporting where its own boxes are |
| `compositor/src/compose.rs`'s CSS reimplementation — rounded corners, shadows, blend | cc does it, correctly, for every property rather than the ones we shimmed |
| `compositor/src/stacking.rs`, `Layer::clip` region-clipping | Same |
| ~~The vendored exo protocols and `--experiment-augmenter`~~ | **Gone.** The engine is no longer a Wayland client of ours, so the protocols it asked for have no one to ask. `src/exo.rs`, `protocols/`, the flag, `scripts/probe-delegated-compositing.sh` and the `wayland-scanner` build dependency went with them |
| Electron | We ship the fork |

Kept: the Wayland server itself, input and seat handling, the output/config
model, the session, and the host brain. That is most of what is hard.

## Getting started

The spike proved the seam before anything was scrapped. It cannot be run on the
machine this was written on — that took a different one, and `crux` is now it,
provisioned and building.

**The machine — measured, on `crux`.** Chromium's own requirements
(`docs/linux/build_instructions.md:14`) are x86-64, "at least 8GB of RAM. More
than 16GB is highly recommended", and "at least 100GB of free disk space",
against the 14 GB a session in this dev container gets. What that actually cost
on a 16-core machine, with no remote execution and a cold cache:

| | |
|---|---|
| first build, wall clock | **4h 16m** — 56,376 steps at 3.67/s |
| CPU time | 3450m user, against 256m wall: ~13.5× parallel across 16 local jobs |
| `du -sh /build` | **97 GB**, including `depot_tools`, the checkout and `out/Domicile` |
| toolchain | Chromium's own `tools/nix/shell.nix`, which worked unaided |

97 GB is the whole footprint, not the checkout alone, and it clears the 100 GB
figure only because the GN args below are a component build with no symbols.
A first build is an afternoon; what matters for carrying a fork is the
incremental rebuild after a rebase onto a new release, which is not measured
yet.

**The checkout**, which is not the sparse clone `STACKING-PARITY.md` describes
— that one is for reading, this one is for building:

```sh
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PWD/depot_tools:$PATH"
mkdir chromium && cd chromium
fetch --nohooks chromium && cd src
./build/install-build-deps.sh      # or, on NixOS, see below
gclient runhooks
```

Upstream ships a Nix dev shell — `tools/nix/shell.nix` and
`tools/nix/flake.nix` — so the toolchain can be pinned the way the rest of this
repo is, rather than through `install-build-deps.sh`:

```sh
NIX_SHELL_RUN='autoninja -C out/Domicile chrome' nix-shell tools/nix/shell.nix
```

**The build**, configured small and fast rather than shippable — a component
build with no symbols, and every Ozone platform off but Wayland and headless:

```sh
gn gen out/Domicile --args='
  is_debug = false
  symbol_level = 0
  is_component_build = true
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_wayland = true
  ozone_platform_headless = true
'
autoninja -C out/Domicile chrome
./out/Domicile/chrome --ozone-platform=wayland
```

Phase 3 swaps `ozone_platform_wayland` for `ozone_platform_drm`; nothing else
about the build changes.

`ozone_platform_headless` is not part of the design — it is what the
measurement machine needs. `crux` has no display server and no Wayland
compositor, so with Wayland alone the engine cannot be started at all and step
2 has nothing to talk to. Two other flags are load-bearing for the same reason
and are documented in `scripts/spike.sh`: `--disable-gpu`, which is half of why
step 2 submits solid colours rather than textures, and `--password-store=basic`,
without which Chrome blocks on a keyring that is not there and never creates a
window.

**The spike**, each step naming what would kill it:

- [x] a browser-process service that allocates a `FrameSinkId` and creates a
      `CompositorFrameSink` through `viz::HostFrameSinkManager` for a client
      that is not a renderer — **not killed**, see *Who may create a frame sink*
      below. `components/domicile/browser/` in the
      series
- [x] a throwaway external submitter pushing solid-colour `CompositorFrame`s to
      it, over a real invitation on a named socket — **not killed**. Viz drew
      `#FFFF00FF` where the external process submitted `#FFFF00FF`. See *What
      it takes to get a surface on the screen*, which also separates what
      hierarchy registration does (BeginFrames) from what embedding does
      (aggregation). `components/domicile/spike/` in the series, run with
      `scripts/spike.sh`
- [x] `canvas.embedExternalSurface()` behind a runtime flag, calling
      `SurfaceLayer::SetSurfaceId` with the brokered id — **not killed**. The
      canvas does not refuse a surface it did not allocate, and neither does
      `cc::SurfaceLayer` under it. See *Whether the page will embed a surface it
      did not allocate*, which also has the control: move the canvas with CSS
      and the producer's surface moves with it. `components/domicile/mojom/`
      and `third_party/blink/` in the series
- [x] **the measurement**: `z-index` against ordinary DOM, `transform`,
      `border-radius`, `opacity`, `filter: blur()`, `mix-blend-mode`, resize,
      and the latency — **passed**. Six of the seven are bit-exact against an
      ordinary element laid out beside them and `transform` differs on a
      one-pixel outline; a submitted frame reaches the display compositor's
      output in one display frame. See *What CSS does to an `<app>`* and *What
      it costs*. `components/domicile/spike/css_parity.cc` in the series, run
      with `scripts/spike-step4.sh`

The last one was the whole point. The three before it were plumbing that either
worked or named its own blocker. **Nothing was deleted from Domicile until the
measurement passed, and it has.**

## The seam: a C ABI, and what crosses it

Step 2 established that a mojom-generated Rust crate cannot reach a cargo
build, and that the bridge is a GN-built library behind a C ABI. This is that
ABI. Phase 1 cannot start without it, because every item in phase 1 crosses it.

**The library owns the mojo, `domicile-compositor` owns the Wayland.** All of
`libdomicile_engine.so` is C++ built by GN: the invitation, the
`FrameSinkBroker` pipe, the `SharedImage` import, the `CompositorFrame`
assembly. None of that reaches cargo, and none of it needs to.

**It must not own the thread.** `domicile-compositor` runs a `calloop` loop —
Smithay's — and mojo wants a task runner of its own. So the library exposes a
pollable fd and does its work when told, rather than blocking or calling back
from a thread the compositor does not know about:

```c
int  domicile_engine_fd(DomicileEngine*);      // add to calloop
void domicile_engine_dispatch(DomicileEngine*); // run pending work, fire callbacks
```

That is the same shape as `wl_display_get_fd` / `wl_display_dispatch`, which is
the loop the compositor already runs.

### What crosses it

| C ABI | Wayland concept it already implements |
|---|---|
| `domicile_surface_create(engine, app_id)` → `FrameSinkId` | a window appearing — the browser holds the page's `embedExternalSurface()` until this is called |
| `domicile_surface_import(surface, dmabuf)` → `BufferId` | `zwp_linux_dmabuf_v1` — the fds the client already sent |
| `domicile_surface_submit(surface, buffer, damage)` | `wl_surface.commit` |
| `released(buffer_id)` | **`wl_buffer.release`** — viz returning a `TransferableResource` is exactly the client's cue to reuse |
| `frame(deadline_us)` | **`wl_surface.frame`** — a viz `BeginFrame` is the callback the client is waiting on |
| `configure(width, height)` | **`xdg_toplevel.configure`** — the page bumped `parent_sequence_number` because its layout box changed |

**The right column is why this is small.** The ABI is not a new protocol to
design and then teach the compositor; it is a translation table between viz and
five Wayland requests `domicile-compositor` already speaks. Every callback has
somewhere obvious to go, and the release path in particular is not a detail:
without it the compositor would reuse a dmabuf viz is still sampling, which is
a tear rather than an error.

### The GPU was there all along

Every measurement in this project up to phase 1 ran `--ozone-platform=headless
--disable-gpu`, and the doc said the dmabuf path was therefore unexercised. The
first thing phase 1 did was check the machine rather than the assumption:

| | |
|---|---|
| render node | `/dev/dri/renderD128`, mode `crw-rw-rw-` |
| GPU | NVIDIA GeForce GTX 970, proprietary driver 580.173.02 |
| displays | none — every connector reads `disconnected` |
| Chromium's renderer string | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 970/PCIe/SSE2, OpenGL ES 3.2)` |
| `scripts/e2e-dmabuf.sh` | **passes on `crux`** — a real GPU client's buffers are imported and delivered. It does not skip |

**What kept the engine on `--disable-gpu` was a library path, not the absence of
a GPU.** ANGLE dlopens `libEGL.so.1`, which is glvnd's, and Chromium's own
toolchain shell does not carry it; NixOS keeps the vendor libraries in
`/run/opengl-driver/lib` and the dispatch library somewhere else again.
`GPU=1 scripts/spike.sh` sets that path, and everything downstream of it — the
whole of step 4, and the iframe cell — runs on the hardware.

That matters beyond convenience: **step 4's one imperfect cell was an artifact
of software rasterisation**, and on the GPU there is no imperfect cell.

### What `domicile_surface_import` still needs, and it is not the GPU

The platform is no longer the blocker. The producer is.

**`exo::Buffer` is browser-process code.** It reaches its `SharedImageInterface`
through `aura::Env::GetInstance()->context_factory()`
(`components/exo/buffer.cc:95`), and `aura::Env` exists only in the browser.
`libdomicile_engine.so` runs in a process the browser did not launch: it holds a
`FrameSinkBroker` pipe and a `CompositorFrameSink`, and **nothing that can make
a `SharedImage`**. A `CompositorFrame` cannot carry a raw dmabuf fd — a
`TransferableResource` names a mailbox, and a mailbox has to be minted by
something with a GPU channel.

So the port needs a second capability brokered, which the ABI table does not
mention. Two ways, and this is a design decision rather than a detail:

| | | |
|---|---|---|
| **broker the channel** | the browser gives the producer a `viz.mojom.Gpu` — `viz::GpuClient` is exactly this, and is what a renderer gets (`render_process_host_impl_receiver_bindings.cc:256`) — and the producer creates its own `SharedImage`s | zero extra hops; hands an external process unrestricted GPU authority, and pulls the whole `gpu::` client stack into the library |
| **broker the import** | the producer sends the dmabuf over the socket it already has; the browser does what `exo::Buffer` does and returns a mailbox and sync token | GPU authority stays in the browser, the port lands in `components/domicile/browser/` beside the broker, and the library keeps its small dependency set. One extra hop per *buffer*, not per frame — buffers are imported once and reused, which is what `released` exists to make safe |

**Settled: broker the import.** The cost is paid once per buffer rather than
per frame, it keeps the authority argument the rest of this design has been
careful about — a page cannot reach a `FrameSinkBroker`, and by the same
reasoning a Wayland compositor should not need a GPU channel to show a window —
and it puts the `exo::Buffer` port in the process that already has everything
`exo::Buffer` uses.

Two things settle it beyond the recommendation. `exo::Buffer` takes its
`SharedImageInterface` from `aura::Env::GetInstance()->context_factory()`
(`components/exo/buffer.cc:95`), so brokering the import ports it *into the
environment it was written for* rather than adapting it to a new one — strictly
less work and less risk. And `released` already exists, so the per-buffer hop is
amortised by a mechanism that is built rather than hoped for.

What this adds to the ABI is one call and one reply, not a new capability:
`domicile_surface_import` sends the dmabuf's fds and description over the socket
already held, and gets back an opaque `BufferId`. The library never sees a
mailbox and never holds a GPU channel.

### Whether the producer can submit its own frames

**Yes. Measured, and the per-frame hop is gone.**

The worry was that "the producer never sees a mailbox" forced the browser to
assemble every frame. It does not. `gpu::ExportedSharedImage` is what a
`SharedImage` looks like to another client — a mailbox, its metadata, and a
sync token the browser has already verified — and it is a mojo struct
(`gpu/ipc/common/exported_shared_image.mojom`). So `ImportBuffer` hands one
back, the producer calls `gpu::ClientSharedImage::ImportUnowned`, builds its own
`viz::TransferableResource`, and submits its own `CompositorFrame` to the sink
it has held since step 2.

**Viz accepts a resource whose `SharedImage` a different client created.** The
texture is sampled and `released` comes back through the producer's *own*
`CompositorFrameSinkClient` — not forwarded by the browser — which is what
proves viz returned the resource to the submitting sink and not somewhere else.
No error, no bad-message report.

| | |
|---|---|
| per-buffer hop | stays — the browser imports, because only it has an `aura::Env` |
| per-frame hop | **gone** — the producer submits straight to viz |
| GPU authority | unmoved. Naming a mailbox is not authority to mint one, and no GPU channel crosses |
| what the library gained | `gpu::ClientSharedImage` and `viz::TransferableResource` — types, not a channel |

**Settled: the types are an acceptable cost.** The objection to brokering the
channel was two things — GPU authority, and dragging the `gpu::` client stack
into the library. The first is untouched: naming a mailbox is not authority to
mint one. The second is partly incurred, and it is worth it, because
`ClientSharedImage::ImportUnowned(ExportedSharedImage)`
(`gpu/command_buffer/client/client_shared_image.h:279`) is Chromium's own
first-class way to say *another client holds this*. Taking the serialisation
types for a supported handoff is not the same as taking a command buffer, and
what it buys is a hop off the path of the one requirement that cannot be
traded.

So `domicile-compositor` submits its own frames, and the browser-owned sink
stays only as the shape a producer gets by passing no receiver to
`CreateFrameSink`. What follows was true while that was the only path:

**The browser can own the `CompositorFrameSink` too.** If the producer never sees a mailbox
then it cannot assemble the `CompositorFrame` either, so `domicile_surface_submit`
names a `BufferId` and the browser builds the frame around the matching
`TransferableResource`. That makes the per-frame path go through the browser,
where the table above says only the import would. A producer that submits its
own frames — the spike's solid-colour ones — still talks to viz directly, and
`CreateFrameSink` takes a null client and receiver to ask for the other shape.
That is no longer the path the design takes — see *Whether the producer can
submit its own frames*, directly above — and it is kept because it is what a
producer with no GPU types at all would use.

**The premise of that consequence should be tested before it hardens.** "If the
producer never sees a mailbox" is the load-bearing clause, and the decision this
sits under says the browser returns *a mailbox and sync token*. A
`gpu::SyncToken` is a POD of four fields — `verified_flush_`, `namespace_id_`,
`command_buffer_id_`, `release_count_` (`gpu/command_buffer/common/sync_token.h:101`)
— so once the browser has verified one it is bytes, and a producer can carry it
in a `TransferableResource` without a GPU channel of its own. If viz accepts a
resource whose `SharedImage` a different client created, the producer can build
and submit its own frames: the per-buffer hop stays, the per-frame hop goes, and
no GPU authority moves.

That is worth an experiment rather than an assumption, because requirement 1 is
the one that cannot be traded and this hop is on its path. **Test it before
phase 2**, which deletes the copy path this would otherwise be compared
against.

### A client's window on the page

**Phase 1's deliverable, and the first full-strength pixel assertion in this
fork.** Every earlier check compared a surface against an ordinary element, or
a buffer against the embedder's fallback. This one is a real Wayland client
drawing a colour of its own choosing and that colour coming back out of the
display compositor:

```
$ nix develop .#full --command \
    scripts/spike-wayland.sh /build/chromium/src \
    scripts/spike-client-window.sh /build/chromium/src
the engine is listening on /tmp/domicile-client-window-broker
driving kitty, drawing #3366CC
the engine drew #FF3366CC; the client drew #3366CC
PASS: a Wayland client's own window is on the page, in its own colour
```

Exact, twice, on two colours. And `NEGATIVE=1` — the same run with no client —
reports `nothing drew` and would fail if anything had.

Four processes: a headless wlroots compositor for the engine to be a client of,
the engine on a page whose `<canvas>` embeds, `domicile-compositor` with
`--engine-socket` as the producer, and kitty as a GL client of *that*. The
compositor is the only process that can ask what viz drew — one producer per
socket — so it logs the pixel and the script reads it.

**The format has to cross the seam, and a real client is what showed it.** The
first run came back `#FFCC6633` against a client drawing `#3366CC`: red and
blue swapped. Every producer in the spike had allocated `ABGR8888`, which
happens to match the `RGBA_8888` the import hardcoded; kitty allocates
`ARGB8888`, which is BGRA in memory. Nothing failed — the window simply drew
with its channels permuted. `ImportBuffer` now carries the client's DRM fourcc
and refuses a format it cannot name rather than guessing.

### What the port measures

`scripts/spike-dmabuf.sh`, under `spike-wayland.sh` because nothing else can:

```
allocated two 992x639 dmabufs as rendering, 1 plane(s), modifier 0x300000000cdb014
imported: buffers 1 and 2
submitted the first
submitted the second, which is what frees the first
released: surface 1 buffer 1 — wl_buffer.release
drew #00000000 from an unfilled renderable dmabuf — sampled, so the texture path works
```

A buffer allocated by a process that is not Chromium, on the render node,
reaches the page as a `TransferableResource` the producer never sees, and comes
back when a later frame replaces it. **`released` fires**, which is the first
time it has.

**It takes two frames to see a release, and that is not a quirk of the test.**
Viz holds the buffer that is on screen; it hands it back when something
replaces it. A compositor that drew into the buffer it had just committed would
tear, which is why a Wayland client double-buffers, and why the harness submits
twice.

**On this GPU a buffer is CPU-writable or sampleable, never both.** NVIDIA's
gbm refuses `rendering|linear` outright. A linear buffer imports without error
and then draws as the embedder's fallback; a tiled renderable one is sampled.
Since the harness has no GL context it cannot put known content in the second,
so the pixel assertion is "the buffer's own zeroed content rather than the
fallback" — `#00000000` against an opaque `#FF000000` — rather than a colour
chosen in advance. `LINEAR=1` runs it the other way and fails, which is what
documents the limitation. A real client renders with the GPU and lands on the
working path; `domicile-compositor` submitting a real client's buffer is what
closes this to a full-strength assertion, and it is the next item.

**Not `SCANOUT`.** A `SharedImage` may only claim it if the buffer was
allocated for it, and a render node with no KMS behind it will not. Claiming it
anyway produces a `SharedImage` that is created and then never drawn — an
afternoon, that one. Overlay promotion is phase 3's, with a display.

The submit path was proved separately before the texture was trusted: the same
browser-owned sink, submitting a `SolidColorDrawQuad`, draws the right pixel.
So a black frame meant the texture and not the plumbing.

### How the ozone platform blocked it before that

Not for want of a GPU, and not for want of NVIDIA. **The ozone platform every
measurement uses cannot import a dmabuf at all.**

A dmabuf becomes a `SharedImage` through
`SurfaceFactoryOzone::CreateNativePixmapFromHandle`, and exactly four platforms
in the tree implement it:

| implements it | does not |
|---|---|
| `drm` (gbm), `wayland`, `x11`, `flatland` | **`headless`** |

`HeadlessSurfaceFactory::CreateNativePixmap` returns a `TestPixmap` — a stub —
and `CreateNativePixmapFromHandle` is not overridden, so the base class's
"unsupported" answer stands. Under `--ozone-platform=headless` there is nothing
for an imported buffer to become, and writing the import against it would
produce a function that compiles, links, and is never once exercised.

So the import needs a different platform, and the shape of the answer is
already in phase 3:

- **`wayland`** — the build already sets `ozone_platform_wayland = true`, and
  the engine would run as a client of a headless compositor. `crux` has weston
  in the full dev shell. This is the cheap one and it is the recommendation.
- **`drm`** — phase 3's own target, and what a real Domicile is. Needs DRM
  master, and `crux`'s connectors are all disconnected, so a headless KMS setup
  is its own piece of work.
- **`x11`** — Xvfb is already used elsewhere in this repo, but X11 plus the
  NVIDIA proprietary driver plus dmabuf import is the least travelled of the
  three.

**Measured, and the answer is yes.** `scripts/spike-wayland.sh` nests the
engine in a headless wlroots compositor and runs any other check under
`--ozone-platform=wayland` on the GPU. Every gate in
`WaylandBufferManagerGpu::GetGbmDevice()` is satisfied on `crux`:

| gate | |
|---|---|
| `use_wayland_gbm` | already `true` in the build |
| host advertises `zwp_linux_dmabuf_v1` | **sway yes, weston no** — see below |
| `EGL_EXT_image_dma_buf_import` | **yes**, on the NVIDIA display: `EGL vendor string: NVIDIA` lists it and `..._modifiers` |
| a GBM backend for the device | **yes** — the proprietary driver ships `nvidia-drm_gbm.so` |
| `gbm_create_device()` on the render node | **succeeds** — Chromium picks `/dev/dri/renderD128` ("picking nvidia-drm") and GL then initialises with `EGL_PLATFORM_GBM_KHR` as its native display, which only happens on that path |

**Chromium's GBM path does not assume Mesa.** That worry was unfounded: NVIDIA
ships its own GBM backend and its EGL imports dmabufs.

**Weston is the wrong compositor for this and wlroots is the right one.**
Weston's headless backend advertises `wl_shm` and nothing else — measured, its
globals contain no `zwp_linux_dmabuf_v1` — and `GetGbmDevice()` returns null
unless the *host* supports dmabuf, so under weston the device is never created
however capable the GPU is. A wlroots headless backend advertises it, because
it builds a renderer on the render node whether or not anything is on screen.

### The open part



One `DomicileEngine` and N surfaces, not one engine per app: one socket to the
browser is one authority to hold. The "one surface per document" question that
used to be attached to this is settled and was never the chrome protocol's —
the renderer keeps one `LocalSurfaceId` per app id, because viz will not let it
do otherwise. See *Open questions*.

## Plan

Phase 1 — real pixels. **Ordered: nothing in phase 2 can start until the
compositor can submit a frame, because phase 2 deletes what draws today.**

- [x] `libdomicile_engine.so` behind the C ABI above — invitation, broker pipe,
      pollable fd. `components/domicile/engine/` in the series, asserted by
      `scripts/spike-engine.sh`: a **C** process that is not Chromium joins the
      browser's mojo graph, is brokered a frame sink, and takes a configure and
      a frame off `domicile_engine_fd` through `domicile_engine_dispatch`
- [x] `frame` → `wl_surface.frame`. Arrives once an embedder exists, which is
      also when `SetNeedsBeginFrame` is worth asking for
- [x] the embedder's `LocalSurfaceId` drives `xdg_toplevel.configure` — the
      C ABI's `configure` callback carries the page's layout box
- [x] **a platform that can import a dmabuf** — `scripts/spike-wayland.sh`,
      and the NVIDIA driver satisfies every gate. See *What
      `domicile_surface_import` still needs*
- [x] port `exo::Buffer`'s dmabuf → `SharedImage` → `TransferableResource`
      behind `domicile_surface_import` — done, under the brokered import.
      `components/domicile/browser/brokered_frame_sink.cc` is the port;
      `scripts/spike-dmabuf.sh` is the assertion
- [x] `released` → `wl_buffer.release` — **fires**, and it took two frames to
      see it: viz holds whatever is on screen and hands it back when a later
      frame replaces it, which is why a client double-buffers
- [x] `domicile-compositor` submits a client's buffer instead of reading it
      back — the only item left in phase 1, and the first that touches the
      compositor. The seam is ready: `domicile_engine_fd` is a `Generic`
      calloop source, which is the pattern `main.rs:6037` already uses, and the
      three callbacks map onto requests the compositor implements. **What is
      not decided is how the Rust reaches the library.** `libdomicile_engine.so`
      is a GN artifact that exists only where Chromium is built, so linking it
      from `cargo` makes `cargo build` need a Chromium checkout — which this
      repo's CI does not have and cannot get. `dlopen` at runtime, behind the
      same `disposition` the compositor already branches on, keeps `cargo
      build` working everywhere and keeps the fork out of the default build.
      **Settled: `dlopen`** — but for build hygiene only. `cargo build` must
      not require a Chromium checkout; that is the whole reason. It is *not* a
      licence to fall back silently when the library is absent. Until phase 2
      the copy path is still there and a missing engine can degrade to it; once
      phase 2 deletes the copy path, a missing `libdomicile_engine.so` is a
      startup failure that says so, because a compositor that silently shows
      nothing is the defect ERRORS.md exists to prevent.
      **Done.** The compositor loads the engine or refuses to start, polls
      `domicile_engine_fd` in its own calloop, imports a client's dmabuf once
      per `wl_buffer`, submits it, and holds `wl_buffer.release` until viz says
      it is done — with a deadline, so a release that never arrives takes the
      buffer back loudly rather than stopping the client. See *A client's
      window on the page*
- [x] ~~**on a machine with a GPU**~~ — `crux` is one. See *The GPU was there
      all along*

Phase 2 — collect the winnings. **After phase 1, not beside it:** deleting the
copy path before the compositor can submit leaves nothing drawing at all.

- [x] delete the vendored exo protocols and `--experiment-augmenter` — the
      self-contained one, and the only one that touches nothing else
- [x] ~~**`--engine-socket` becomes required.**~~ **Reversed by the attempt.**
      It cannot be required: CI has no Chromium build, so requiring it fails
      every `scripts/e2e-*.sh` and the integration tests — the suite that
      guards the deletion. What ships instead is a compositor that announces
      the no-engine configuration at startup, because without the flag there
      is now no path to a window at all and a desktop showing none has to give
      the reason whether the reason is a failure or a choice
- [ ] **an shm→dmabuf upload, *after* the copy path goes.** `publish_frame`
      submits only `CommittedBuffer::Gpu`; an shm client rides the copy path
      today, so deleting that path takes the window away from every toolkit
      that does not render with GL — which is most of them.

      **Settled by the project owner, and settled the other way from the
      recommendation.** The upload is not a prerequisite: the copy path goes
      first and shm clients break in the interim. Nothing is released and
      nobody is using it, so the regression costs nothing real, and the
      shortest route to the end state is worth more than keeping an interim
      tree usable. The upload lands afterwards, on the engine path, once
      there is one path to write it against instead of two.

      This is a deliberate, time-boxed regression rather than a change of
      mind about the principle: a shipped desktop that silently shows no
      window is still the defect ERRORS.md is about. Whoever closes this box
      should make an shm client's failure *say* so rather than draw nothing,
      and the box is not closed until the upload exists.

      **The saying-so is done**: `publish_frame` refuses a non-dmabuf buffer
      once per client, naming the client and pointing here. The upload is not
- [x] delete the copy path, `AppFrame`, the hand-over pass, the over-window
      pass and the measure loop's frame half — 5,238 lines out over two
      commits. `straight_alpha.rs`, `over_window.rs`, most of
      `dmabuf_import.rs`, the outbound frame queue, `host-stream.ts`'s byte
      framing and both shells' frame handlers went with them

      Two instruments were **kept and emptied rather than deleted**, with the
      reason in a doc comment on each: `BridgeClient.roundTrip` and
      `AppElements.drawTiming` measured keystroke-to-pixel latency, and could
      only do it because the bridge drew the frame. That is the measurement
      this fork answers to, so it has to be rebuilt in the compositor, which
      sends the key and holds the engine connection that knows when viz
      presented
- [ ] **rebuild the latency measurement** in the compositor — see above. Until
      it exists nothing measures the requirement the fork is for
- [ ] bands, the shaders and `compose.rs`'s CSS reimplementation. Still
      standing: they draw the chrome and the desktop, which the engine path
      does not replace
- [x] `<domicile-app>` becomes a `<canvas>` and one call. The element creates a
      canvas and calls `canvas.embedExternalSurface(appId)`; nothing copies
      anything. Absent outside the fork, where the element still lays out,
      reports its box and routes pointers and says once that it cannot show a
      window

      **The app id is the change under it.** `FrameSinkBroker::Embed` used to
      hand every embedder the sink brokered most recently, which is right for
      exactly one window and silently wrong for two: a shell showing a terminal
      and an editor would draw the same client in both. The id now crosses the
      whole seam — `CreateFrameSink`'s `debug_label` became a load-bearing
      `app_id`, `Embed` takes one, pending embeds are held per app — and two
      browser unit tests pin it

Phase 3 — be the display server:

- [ ] Ozone/DRM instead of a nested backend

## Open questions

- **Input.** `SurfaceLayer::SetSurfaceHitTestable` exists and viz has a
  hit-test path, but Domicile already routes input and knows the client. The
  recommendation is to keep our routing and let the page report the box, which
  is what it does today — but whether viz's hit-test data has to agree with
  ours to avoid the engine swallowing events is not established.
- **Where the Wayland server runs.** External keeps the fork to a bridge and
  keeps the Rust. In-tree would get a GPU channel and `HostFrameSinkManager`
  for free. Recommendation: **still external**, and step 2 is why rather than
  the earlier hope. An external process was given a frame sink and had its
  frames aggregated, with no privilege it could not be handed and no
  `RenderProcessHost` anywhere. What step 2 also found is that the mojom-crate
  route into cargo is not the bridge — see *Rust: the bindings exist, the crate
  is not the seam*. The bridge is a GN-built library behind a C ABI, and which
  side of it the mojo code sits on is now an ordinary engineering choice rather
  than a blocker. Phase 1 is where it gets made, because that is where the
  producer stops being throwaway.
- ~~**Who may reach the broker.**~~ Settled, and by the transport rather than
  by a policy. Holding a `FrameSinkBroker` pipe is unrestricted authority to
  allocate frame sinks in viz, so the socket the invitation is sent over is the
  whole of the access control: a `NamedPlatformChannel` at a path only the
  compositor can open, one connection at startup, no capability a renderer can
  pass on. What remains is filesystem permissions on that path, which is step
  2's to get right and is not an open design question.
- **Build and CI cost.** A from-scratch build is 4h 16m and 97 GB on one
  16-core machine — an afternoon rather than a build farm. What the series
  itself costs, measured on `crux` against a tree already built at the pin:

  | | |
  |---|---|
  | null build — ninja stats 56k targets, nothing to do | **6–7s** |
  | apply the whole series to a built tree, `autoninja chrome` | **65s** |
  | edit `frame_sink_broker.cc` → `chrome` | **14s** |
  | edit `frame_sink_broker.h` → `chrome` | **13s** |

  Net of the floor that is ~1m to lay the series down — `gn` regen, the mojom
  generation, three objects, and relinking `libcontent.so` and `chrome` — and
  ~6s per subsequent edit. The series is additive, so it widens nothing's
  blast radius: the one dep it adds runs `//content/browser` →
  `//components/domicile:browser`, and the header behind it is included by
  exactly one file.

  **The rebase number is still not measured** — that needs the pin rolled onto
  a later revision, which has not happened. But it is now clear it will be
  upstream's number rather than the fork's: whatever a six-week upstream diff
  costs to rebuild, carrying this adds seconds to it. This repo's CI still will
  not carry either.
- ~~**Not verified by measurement.**~~ Closed twice over. All seven properties
  are observed rather than read off the mechanism, and on a GPU every one is
  bit-exact; the last argued claim — that an OOPIF differs from a `<div>` the
  same way an `<app>` does — was measured and turned out to be false in the
  direction that helps. See *Whether an `<app>` is an out-of-process
  `<iframe>`*. What remains unmeasured is **presentation**: `crux` has a GPU
  but no display and no compositor to compare against, so the latency number is
  "one display frame into the display compositor's output" and not "commit to
  scanout". That needs the machine phase 3 needs.
- ~~**Whether NVIDIA can satisfy `CreateNativePixmapFromHandle`.**~~ Closed: it
  can, under a wlroots headless compositor. The GBM path does not assume Mesa.
- **How the producer gets to make a `SharedImage`.** It cannot today, and this
  is the last thing between phase 1 and real pixels. Broker a GPU channel to an
  external process, or have the browser do the import and hand back a mailbox?
  Recommendation is the second, with the reasoning in *What
  `domicile_surface_import` still needs*. **This is a decision, not a detail:**
  the first hands a process the browser did not launch the same GPU authority a
  renderer has.
- ~~**One surface per document, in the spike only.**~~ Closed, and it was never
  a simplification that could have been left standing. viz keys
  `SurfaceAllocationGroup` on a `LocalSurfaceId`'s `embed_token` alone and
  refuses a second `FrameSinkId` under a token another sink owns, so one token
  per document does not give eight elements one producer — it gives the second
  window no surface at all and shows the first window in its place.
  `spike-two-windows.sh` measured exactly that. `ExternalSurfaceEmbedder` now
  keeps one allocator per app id; the reasoning is in `AllocatorForApp`.
- **Nothing invalidates a renderer's token when a producer goes away.** The map
  above is keyed on an app id, and app ids are minted from a counter that
  starts over when the compositor restarts. So a compositor restarting under a
  running browser gets `app-1` brokered a new `FrameSinkId` while the page
  still holds `app-1`'s old token, and every embed of it is refused from then
  on. The browser knows when a producer disconnects — `OnProducerDisconnected`
  drops its sinks — and does not tell the renderer. Phase 1's, and it is the
  reload case a shell hits first.
