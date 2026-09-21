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
(`third_party/blink/renderer/core/frame/remote_frame.cc:1003`):

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

And the embedding itself, from
`third_party/blink/renderer/core/frame/child_frame_compositing_helper.cc:60`:

```cpp
surface_layer_ = cc::SurfaceLayer::Create();
// … SetMasksToBounds, SetSurfaceHitTestable, SetBackgroundColor …
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
embedder's three jobs was switched off in turn, on the spike as it stood; the
switches are gone and the finding is what is left:

| | | |
|---|---|---|
| | BeginFrames | aggregated |
| hierarchy + `SurfaceLayer` | yes | **yes** — drew `#FFFF00FF`, the color submitted |
| `SurfaceLayer` only | **no** | **yes** — the frame submitted with a manual `BeginFrameAck` was still drawn |
| hierarchy only | yes | no — nothing named the `SurfaceId`, so there was nothing to draw |

`RegisterFrameSinkHierarchy` is about **BeginFrames**: a producer that does not
need viz to drive it can skip it and still get pixels on screen. Aggregation
needs an **embedder naming the `SurfaceId` in a `SurfaceDrawQuad`** — the
design's `cc::SurfaceLayer`, which step 3 moved from the browser's UI into the
page.

The proof is a pixel, not a log line. The embedder issues a `CopyOutputRequest`
on the embedding layer, which viz answers out of the display compositor's draw
*after* the aggregator has resolved the `SurfaceDrawQuad`, and hands the center
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
$ ... packages/domicile-engine/scripts/spike.sh /build/chromium/src -- --color=FF00C853
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
a comparison rather than a judgment.
`packages/domicile-engine/scripts/guard-css-and-resize.sh`, 53,200 pixels per
cell, and the same numbers to the pixel on every run:

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

**`transform`'s 285 pixels were software rasterization, not the mechanism.**
The table above is `--disable-gpu`, which every measurement in this project was
until phase 1 found that `crux` has a GPU. On the GPU, with nothing else
changed, **every cell is 0** — `transform` included, and resize with it:

| | differ | interior | worst Δ |
|---|---|---|---|
| all seven properties | **0** | 0 | 0–3 |

So an `<app>` is not "a `<div>` up to a one-pixel outline"; it is a `<div>`.
The outline was two software raster passes disagreeing in the last bit, and it
is gone on the hardware a user would have.
`GPU=1 packages/domicile-engine/scripts/guard-css-and-resize.sh` is that run.

**Both tables were re-taken through the native `<app>`, and not one number
moved.** Every figure above was first measured through
`canvas.embedExternalSurface()` — the SDK's `<domicile-app>` wrapped exactly
that call, and the wrapper is gone, so the table described a path no shell
takes. `spike-css-page.html` and `spike-resize-page.html` write the fork's own
tag now: `<app app-id="…">`, embedded from layout by
`HTMLAppElement::Embed`. Re-run on `crux` against the same series, software and
GPU, the two tables above reproduce cell for cell — 285 `transform` edge pixels
and 0 interior ones under software rasterization, every cell 0 on the GPU, and
the negative control's 10,800 differing and 9,976 interior on both.

A null result, which is the claim: the same layer through two call sites draws
the same pixels. What it buys is a table that is evidence about the element a
shell writes — which for two days it was not. See the `GetElementType` entry in
phase 2.

**The resize row changed in kind, though not in value.** Through the canvas
that row was the page calling the embed method a second time after growing the
box, which measures a method. The tag has no method: the page changes one CSS
rule, `LayoutAppSurface::UpdateAfterLayout` reports the box layout gave it, and
the element re-embeds at the new size on its own. The producer sees
`LocalSurfaceId(1, 1, …) at 120x90` become `LocalSurfaceId(2, 1, …) at
180x130` — a bumped parent sequence number, which is the `xdg_toplevel.configure`
— with nothing in the page having asked for it. **That is the sentence the
placement deletion rests on**, now measured rather than argued:
an `<app>`'s layout box *is* the configure.

`scripts/test-parity-page-uses-the-native-tag.sh` is what keeps it that way. It
is a grep, it needs no Chromium tree, and it runs in the shell group on every
push — because the drift it catches does not fail anything: a page quietly back
on the canvas measures the wrong path and passes.

Two things stop this from passing for the wrong reason. Each property cell is
also compared against the baseline cell, and a cell whose property never took
effect — a class that did not match, a stylesheet that did not load — leaves
both halves plain, and two plain halves match; the run fails unless every
property visibly changed its cell. And the last cell's control is a color the
producer never submits, so a diff that cannot see a difference fails there.

### Whether an `<app>` is an out-of-process `<iframe>`

**No, and it does not need to be.** The claim in the row above — that an `<app>`
differs from a `<div>` only the way any surface-backed element does, an OOPIF
included — was read off `child_frame_compositing_helper.cc` and never measured.
Measured, on the GPU, under the same `transform`, with a cross-site `<iframe>`
in a renderer of its own
(`packages/domicile-engine/scripts/spike-iframe.sh`, 7 renderer processes at
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

**This table is still on the canvas path.** `spike-iframe-page.html` has not
been moved onto the tag, and the parity re-take is what makes that tolerable:
the two call sites agree to the pixel, so the `<app>` column here is the same
column either way. What would make moving it urgent is any number disagreeing
between the paths, and none does.

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

### What the producer's half costs

One display frame — which is what it costs to ask the question at all. This is
the producer's half, from a submit to the display compositor's output. What a
user waits for is longer and is measured separately, by `guard-latency.sh`; see
*Keystroke to pixel* below.

The producer changes the color it is submitting and then polls the browser for
the pixel where the page put the `<app>`, until that pixel is the new color.
Sixty rounds of it, against sixty rounds of the same poll with nothing changed:

| | |
|---|---|
| display frame interval, from viz's own `BeginFrameArgs` | **16.67 ms** |
| poll round trip, nothing changed | median 16.67 ms, **1.0 frames** |
| submit to the new color being in the display compositor's output | median 16.68 ms, **1.0 frames** |
| draws the new color took to appear | **1**, on 60 of 60 rounds |

The two distributions are indistinguishable, and that is the result: a frame
from a process outside the renderer is aggregated into the same display frame
as the page around it, with no stage of its own. On a busy machine both numbers
move together to 2.0 frames, which is the measurement's own noise rather than
the producer's.

**Re-taken through the native `<app>`, five runs, and the pair moves together
every time.** Software and GPU, the same series, minutes apart on an otherwise
idle `crux`:

| | poll round trip | submit to drawn |
|---|---|---|
| canvas, software | 33.23 ms, 2.0 frames | 33.43 ms, 2.0 frames |
| `<app>`, software | 16.57 ms, 1.0 frames | 16.66 ms, 1.0 frames |
| `<app>`, GPU | 16.84 ms, 1.0 frames | 16.57 ms, 1.0 frames |
| `<app>`, software | 32.28 ms, 1.9 frames | 33.32 ms, 2.0 frames |
| `<app>`, GPU | 33.31 ms, 2.0 frames | 33.36 ms, 2.0 frames |

`draws the new color took to appear` is **1, on 60 of 60 rounds, in all five**.
So the figure swings between one display frame and two from run to run, on the
same binary and the same page, and the two columns never disagree by more than
a tenth of a frame — including in the two runs that landed on 2.0. **That is
the shape of the result, and it is worth more than the median.** The absolute
number is the probe's own round trip plus whatever else the machine is doing;
what the design claims is that a client's frame costs no stage of its own, and
what says so is the two columns moving as one, not either of them landing on
16.67 ms. A future reading of 2.0 here is the machine, and the way to tell is
whether the control moved with it.

**What this is not is latency parity with a plain Wayland compositor.** There
is no Wayland compositor here to compare against. What the number does
establish is the thing the design claims structurally: no readback, no socket,
no extra composite, no frame held for a stage of its own. What it does not
touch is presentation: everything here is measured out of a
`CopyOutputRequest` that forces the draw it then reads, which is the only way
to see what the display compositor drew and is itself the 16.67 ms.

### Keystroke to pixel

**Measured, on `crux`, and it is 1.7 display frames.** The section above times
the producer's half from inside the browser.
`packages/domicile-engine/scripts/guard-latency.sh` times the whole of what a
user waits for — a key into a client's seat, the client drawing, the pixel
arriving on the page — from outside it, with a real Wayland client under
`under-wayland.sh`. Four CI runs:

| | commit to pixel | frame | ratio |
|---|---|---|---|
| run 1 | 29.18 ms | 48.71 ms (floor sample) | 0.60 |
| run 2 | 27.99 ms | 16.67 ms | 1.70 |
| run 3 | 28.18 ms | 16.67 ms | 1.69 |
| run 4 | 28.24 ms | 16.67 ms | 1.71 |

`commit to pixel` moves by four percent across all four. The guard's bar is a
count of display frames — `MOST_FRAMES=2`, where a stage of its own is one more
frame — and never a millisecond figure, because a millisecond threshold is a
threshold on whatever else the runner was doing. Run 1 is why the denominator
is the run's own reported frame rather than the sampled floor: a floor of
48.71 ms is not merely noisy but impossible, since `commit to pixel` is
quantized to probe round trips and that run's was 29.18. `guard-latency.sh`'s
header carries the whole argument.

**The wait for the client's frame is watched, or the figure is not a
keystroke's.** Nothing the client draws in answer reaches the screen before the
frame it commits, so a color change seen before that commit came from a frame
committed before the key. The run gives those rounds up and counts them
(`round(s) whose pixel moved before the client answered`) rather than timing
them from whichever commit came next. The negative control found this by
failing: a client that answers no keys still reported 25.93 ms commit to pixel
over one round. The cost is up to one probe round trip inside `key to commit`,
which is the bucket already declared impure.

**Two instruments agree on the frame.** In the same CI job as run 4,
`css_parity.cc` — which runs inside the browser and can ask viz — reported a
`BeginFrameArgs` interval of 16.67 ms and a probe round trip with a median of
16.75 ms, against the 16.67 ms this compositor advertises.

**What is still not measured is presentation.** These runs are in a nested
compositor with nothing on a screen, and the probe's own round trip is inside
every figure.

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
   argument is how few Chromium-owned files it edits — 21 for this design —
   that is the number that matters.
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
| Brokering a `FrameSinkId` and sink to a non-renderer process | `components/domicile/`, modeled on `content/browser/renderer_host/embedded_frame_sink_provider_impl.cc` | **done** — new files + 4 lines across two `BUILD.gn`. Not `render_process_host_impl_receiver_bindings.cc` as first guessed: nothing about it hangs off a `RenderProcessHost` |
| Getting the producer to the broker | `mojo::NamedPlatformChannel` + a real invitation | **done** — see *How the producer reaches the broker*. One edited file: the socket opens at browser startup, because a shell's page cannot embed until a window exists and no window exists until a producer has connected over it |
| Pushing the `SurfaceId` to the page | `components/domicile/mojom/external_surface.mojom`, modeled on the `RemoteFrame` path | **done** — new files, plus one binder line in `render_process_host_impl_receiver_bindings.cc` |
| An element that embeds it | `HTMLAppElement`, patch `0007`, with `LayoutAppSurface` reporting its box and `ExternalSurfaceEmbedder` resolving the `SurfaceId` | **done** — `<app app-id="…">`. `HTMLCanvasElement::embedExternalSurface()` came first and is still in the series (patch `0002`), because the spike's pages measure through it |

## Why this meets the requirements

| Requirement | How |
|---|---|
| **Latency parity** | The client's dmabuf becomes a `SharedImage` and rides in a texture quad. Viz aggregates it into the display frame — the same single composite any Wayland compositor does. No readback, no socket, no `putImageData`. **Measured** twice: the producer's half at one display frame, indistinguishable from the probe's own floor, and keystroke to pixel at 1.7 frames against a bar of 2. Viz's `OverlayProcessor` could take the quad further, to direct scanout, but nothing has run with a display to try it. See *What the producer's half costs* and *Keystroke to pixel* |
| **CSS parity** | The window is a `cc::Layer`. Whatever CSS works on a hardware-composited `<video>` works, because it is the same layer type through the same property trees. This is the requirement's own wording — "just like a `<webview>` or `<iframe>` or `<video>`" — met by using literally that mechanism. **Measured on a GPU through the fork's own tag: seven properties, every one bit-exact against an ordinary element**, and an `<app>` is closer to a `<div>` than an out-of-process `<iframe>` is. See *What CSS does to an `<app>`* and *Whether an `<app>` is an out-of-process `<iframe>`* |
| **Shell simplicity** | `<app>` is a tag the fork defines, and a shell writes it. Patch `0007`'s `HTMLAppElement` owns the embed, so a shell writes `<app app-id="…">` and the SDK supplies the tag-name map rather than a class. What a shell writes is a tag, not a component |

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
- **`<app>` is a real element, and that decision was taken twice.** Reusing
  `HTMLCanvasElement`'s layer came first, to stay out of `html_tag_names.json5`,
  `runtime_enabled_features.json5` and the element factory — generated lists
  that rebase noisily every release. Patch `0007` reversed it and paid the
  eleven edited files below. What it bought is a tag a shell author writes,
  with `app-id` reflection and default styling, rather than a canvas with a
  method on it. The method is still there, in patch `0002`, because the spike's
  measurement pages go through it.
- **Minimize edited files, not added ones.** A fork's carrying cost is conflicts,
  and new files do not conflict. Counted over patches `0001`–`0007`, which are
  this design and nothing else, it is **21 files, 15 of them Blink's** — and
  where the other eleven went is the story:

  | | |
  |---|---|
  | `components/BUILD.gn`, `content/browser/BUILD.gn` | source lists and deps |
  | `content/browser/browser_main_loop.cc` | one call, opening the producer's socket at startup |
  | `content/browser/renderer_host/render_process_host_impl_receiver_bindings.cc` | one `AddUIThreadInterface` beside the one for `EmbeddedFrameSinkProvider` |
  | `third_party/blink/renderer/core/html/canvas/html_canvas_element.{h,cc,idl}` | the method |
  | `third_party/blink/renderer/platform/runtime_enabled_features.json5` | the feature entry — `status: "stable"`, so nothing has to pass a flag |
  | `third_party/blink/renderer/platform/BUILD.gn` | the new file and its mojom dep |
  | `ui/gfx/linux/gbm_wrapper.cc` | importing a client's dmabuf that the display device cannot scan out |
  | **patch 0007's eleven** — the two `json5` name lists, `build.gni`, the two `bindings/*.gni`, `html_frame_element_base.h`, `html.css`, `style_adjuster.cc`, `display_item.{h,cc}`, `extensions/renderer/dispatcher.cc` | defining `<app>` and `<webview>` as real elements |

  Everything else is additive, and what rebases noisily is the generated lists:
  `runtime_enabled_features.json5`, the two `json5` name lists, the `.gni`
  bindings lists and the `BUILD.gn` source lists.

  The last row is the reversal in the bullet above, priced. Eleven files is
  what defining `<app>` and `<webview>` properly cost, and it was paid
  deliberately.

  **The whole series is bigger than this design, and the split is worth
  keeping.** At `0024` it edits **78 files, 23 of them Blink's**:

  | patches | edited | Blink's | |
  |---|---|---|---|
  | `0001`–`0007` | 21 | 15 | this design |
  | `0008`–`0009` | 15 | 6 | `domicile://` and the control channel |
  | `0010`–`0011` | 6 | 4 | `<webview>` and its guest |
  | `0012`–`0024` | 42 | 0 | Ozone/DRM — `A-DESKTOP-ON-A-TTY.md` |

  Nothing in the last row touches Blink, and nothing in the first four rows
  overlaps much: the tty work is a port of an embedder into
  `ui/ozone/platform/drm`, not more of this. Re-count it with
  `git format-patch`'s own headers rather than trusting this table after a
  rebase.

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
  ozone_platform_drm = true
'
autoninja -C out/Domicile chrome
./out/Domicile/chrome --ozone-platform=wayland
```

**`ozone_platform_drm = true` is a patch, and it is in the series.** At this
pin `ui/ozone/platform/drm/BUILD.gn:14` opens with `assert(is_chromeos, "Ozone
DRM platform is ChromeOS-only")`, and `ui/ozone/BUILD.gn:45` makes
`platform/drm:gbm` a dependency of `//ui/ozone` the moment the argument is
true, so `gn gen` refused before anything was compiled. Patch `0012` relaxed
that assert; `0013` and `0016` put an embedder behind the platform, because a
platform with no embedder turns a clear refusal into a crash. Adding a platform
does not change the default one — `ozone_platform` is unset, so
`//ui/ozone/BUILD.gn`'s own order stands and headless is still first.
`docs/architecture/A-DESKTOP-ON-A-TTY.md` is that work; this doc stops at the
argument.

**A failed `gn gen` wedges the tree it failed in.** The argument is written to
`args.gn` before an assert fires, and ninja re-runs gn on every build, so
every later build in that output directory fails with `rebuild manifest
failed` — on `crux`, which keeps one warm tree for every branch, that is every
engine run until the arguments are written again.
`packages/domicile-engine/scripts/build.sh` passes `--args` unconditionally
now, which is both what makes an edit to it take effect and what repairs a tree
somebody else's failure left behind.

`ozone_platform_headless` is not part of the design — it is what the
measurement machine needs. `crux` has no display server and no Wayland
compositor, so with Wayland alone the engine cannot be started at all and step
2 has nothing to talk to. Two other flags are load-bearing for the same reason
and are documented in `packages/domicile-engine/scripts/spike.sh`:
`--disable-gpu`, which is half of why step 2 submits solid colors rather than
textures, and `--password-store=basic`, without which Chrome blocks on a
keyring that is not there and never creates a window.

**The spike**, each step naming what would kill it:

- [x] a browser-process service that allocates a `FrameSinkId` and creates a
      `CompositorFrameSink` through `viz::HostFrameSinkManager` for a client
      that is not a renderer — **not killed**, see *Who may create a frame sink*
      below. `components/domicile/browser/` in the
      series
- [x] a throwaway external submitter pushing solid-color `CompositorFrame`s to
      it, over a real invitation on a named socket — **not killed**. Viz drew
      `#FFFF00FF` where the external process submitted `#FFFF00FF`. See *What
      it takes to get a surface on the screen*, which also separates what
      hierarchy registration does (BeginFrames) from what embedding does
      (aggregation). `components/domicile/spike/` in the series, run with
      `packages/domicile-engine/scripts/spike.sh`
- [x] `canvas.embedExternalSurface()`, calling `SurfaceLayer::SetSurfaceId`
      with the brokered id — **not killed**. The
      canvas does not refuse a surface it did not allocate, and neither does
      `cc::SurfaceLayer` under it. See *Whether the page will embed a surface it
      did not allocate*, which also has the control: move the canvas with CSS
      and the producer's surface moves with it. `components/domicile/mojom/`
      and `third_party/blink/` in the series
- [x] **the measurement**: `z-index` against ordinary DOM, `transform`,
      `border-radius`, `opacity`, `filter: blur()`, `mix-blend-mode`, resize,
      and the latency — **passed**, every property bit-exact on the GPU, and a
      submitted frame reaching the display compositor's output in one display
      frame. Taken through the canvas, **re-taken through the native `<app>`
      with no number moving**. See *What CSS does to an `<app>`* and *What the
      producer's half costs*. `components/domicile/spike/css_parity.cc` in the
      series, run with
      `packages/domicile-engine/scripts/guard-css-and-resize.sh`

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
| `domicile_surface_create(engine, app_id)` → `DomicileSurfaceId` | a window appearing — the browser holds the page's embed until this is called |
| `domicile_surface_import(surface, dmabuf)` → `DomicileBufferId` | `zwp_linux_dmabuf_v1` — the fds the client already sent |
| `domicile_surface_submit(surface, buffer, damage)` | `wl_surface.commit` — an empty rectangle means the whole surface |
| `released(surface, buffer)` | **`wl_buffer.release`** — viz returning a `TransferableResource` is exactly the client's cue to reuse |
| `frame(surface, deadline_us)` | **`wl_surface.frame`** — a viz `BeginFrame` is the callback the client is waiting on |
| `configure(surface, width, height)` | **`xdg_toplevel.configure`** — the page bumped `parent_sequence_number` because its layout box changed |
| `displays(displays, count)` | **`wl_output`** — the whole list, primary first, and never empty |

`domicile_engine.h` is the whole ABI; the lifetime calls
(`domicile_engine_connect` / `_destroy`, `domicile_surface_destroy`,
`domicile_buffer_destroy`) are there too and map onto nothing in particular.

**The right column is why this is small.** The ABI is not a new protocol to
design and then teach the compositor; it is a translation table between viz and
Wayland requests `domicile-compositor` already speaks. Every callback has
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
`GPU=1 packages/domicile-engine/scripts/spike.sh` sets that path, and
everything downstream of it — the whole of step 4, and the iframe cell — runs
on the hardware.

That matters beyond convenience: **step 4's one imperfect cell was an artifact
of software rasterization**, and on the GPU there is no imperfect cell.

### What `domicile_surface_import` still needs, and it is not the GPU

The platform is no longer the blocker. The producer is.

**`exo::Buffer` is browser-process code.** It reaches its `SharedImageInterface`
through `aura::Env::GetInstance()->context_factory()`
(`components/exo/buffer.cc:97`), and `aura::Env` exists only in the browser.
`libdomicile_engine.so` runs in a process the browser did not launch: it holds a
`FrameSinkBroker` pipe and a `CompositorFrameSink`, and **nothing that can make
a `SharedImage`**. A `CompositorFrame` cannot carry a raw dmabuf fd — a
`TransferableResource` names a mailbox, and a mailbox has to be minted by
something with a GPU channel.

So the port needs a second capability brokered, which the ABI table does not
mention. Two ways, and this is a design decision rather than a detail:

| | | |
|---|---|---|
| **broker the channel** | the browser gives the producer a `viz.mojom.Gpu` — `viz::GpuClient` is exactly this, and is what a renderer gets (`render_process_host_impl_receiver_bindings.cc:247`) — and the producer creates its own `SharedImage`s | zero extra hops; hands an external process unrestricted GPU authority, and pulls the whole `gpu::` client stack into the library |
| **broker the import** | the producer sends the dmabuf over the socket it already has; the browser does what `exo::Buffer` does and returns a mailbox and sync token | GPU authority stays in the browser, the port lands in `components/domicile/browser/` beside the broker, and the library keeps its small dependency set. One extra hop per *buffer*, not per frame — buffers are imported once and reused, which is what `released` exists to make safe |

**Settled: broker the import.** The cost is paid once per buffer rather than
per frame, it keeps the authority argument the rest of this design has been
careful about — a page cannot reach a `FrameSinkBroker`, and by the same
reasoning a Wayland compositor should not need a GPU channel to show a window —
and it puts the `exo::Buffer` port in the process that already has everything
`exo::Buffer` uses.

Two things settle it beyond the recommendation. `exo::Buffer` takes its
`SharedImageInterface` from `aura::Env::GetInstance()->context_factory()`
(`components/exo/buffer.cc:97`), so brokering the import ports it *into the
environment it was written for* rather than adapting it to a new one — strictly
less work and less risk. And `released` already exists, so the per-buffer hop is
amortized by a mechanism that is built rather than hoped for.

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
first-class way to say *another client holds this*. Taking the serialization
types for a supported handoff is not the same as taking a command buffer, and
what it buys is a hop off the path of the one requirement that cannot be
traded.

So `domicile-compositor` submits its own frames. The browser-owned sink is
still reachable — a producer that passes no client and no receiver to
`CreateFrameSink` gets one, and the browser assembles its frames around the
`BufferId`s it named — and it stays for a producer with no GPU types at all.
Nothing in this design takes it.

### A client's window on the page

**Phase 1's deliverable, and the first full-strength pixel assertion in this
fork.** Every earlier check compared a surface against an ordinary element, or
a buffer against the embedder's fallback. This one is a real Wayland client
drawing a color of its own choosing and that color coming back out of the
display compositor:

```
$ nix develop .#full --command \
    packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
    packages/domicile-engine/scripts/guard-client-window.sh /build/chromium/src
the engine is listening on /tmp/domicile-client-window-broker
driving kitty, drawing #3366CC
the engine drew #FF3366CC; the client drew #3366CC
PASS: a Wayland client's own window is on the page, in its own color
```

Exact, twice, on two colors. And `NEGATIVE=1` — the same run with no client —
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

`packages/domicile-engine/scripts/spike-dmabuf.sh`, under `under-wayland.sh`
because nothing else can:

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
fallback" — `#00000000` against an opaque `#FF000000` — rather than a color
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
  NVIDIA proprietary driver plus dmabuf import is the least traveled of the
  three.

**Measured, and the answer is yes.**
`packages/domicile-engine/scripts/under-wayland.sh` nests the engine in a
headless wlroots compositor and runs any other check under
`--ozone-platform=wayland` on the GPU. Every gate in
`WaylandBufferManagerGpu::GetGbmDevice()` is satisfied on `crux`:

| gate | |
|---|---|
| `use_wayland_gbm` | already `true` in the build |
| host advertises `zwp_linux_dmabuf_v1` | **sway yes, weston no** — see below |
| `EGL_EXT_image_dma_buf_import` | **yes**, on the NVIDIA display: `EGL vendor string: NVIDIA` lists it and `..._modifiers` |
| a GBM backend for the device | **yes** — the proprietary driver ships `nvidia-drm_gbm.so` |
| `gbm_create_device()` on the render node | **succeeds** — Chromium picks `/dev/dri/renderD128` ("picking nvidia-drm") and GL then initializes with `EGL_PLATFORM_GBM_KHR` as its native display, which only happens on that path |

**Chromium's GBM path does not assume Mesa.** That worry was unfounded: NVIDIA
ships its own GBM backend and its EGL imports dmabufs.

**Weston is the wrong compositor for this and wlroots is the right one.**
Weston's headless backend advertises `wl_shm` and nothing else — measured, its
globals contain no `zwp_linux_dmabuf_v1` — and `GetGbmDevice()` returns null
unless the *host* supports dmabuf, so under weston the device is never created
however capable the GPU is. A wlroots headless backend advertises it, because
it builds a renderer on the render node whether or not anything is on screen.

### One engine, N surfaces

One `DomicileEngine` and N surfaces, not one engine per app: one socket to the
browser is one authority to hold. Which surface an `<app>` shows is settled by
app id and not by document — the renderer holds one `LocalSurfaceId` allocator
per app id, so several elements naming one app show one producer and elements
naming different apps get different surfaces. Viz refuses two frame sinks under
one embed token outright, so there was never a choice.
`third_party/blink/renderer/platform/graphics/external_surface_embedder.h`
carries the reasoning next to the code.

## Plan

Phase 1 — real pixels. **Done.** `libdomicile_engine.so` behind the C ABI
above, the brokered frame sink, the dmabuf import ported from `exo::Buffer`,
`released` → `wl_buffer.release`, and the compositor submitting a client's
buffer. `components/domicile/` in the series is the engine half and the
`packages/domicile-engine/scripts/spike-*.sh` are its assertions; *A client's
window on the page* is what it does at run time.

The compositor **`dlopen`s** that library rather than linking it, so `cargo
build` does not need a Chromium checkout — CI has none and cannot get one. It
is not a license to degrade: the compositor loads the engine or refuses to
start, because a desktop that silently shows nothing is the defect ERRORS.md
exists to prevent.

Phase 2 — collect the winnings. **After phase 1, not beside it:** deleting the
copy path before the compositor can submit leaves nothing drawing at all.

- [x] the vendored exo protocols and `--experiment-augmenter`
- [x] the copy path, `AppFrame`, the hand-over pass, the over-window pass and
      the measure loop's frame half — 5,238 lines
- [x] bands, and the readback that labeled them
- [x] **one surface per app id.** A broker that hands every embedder the sink
      it made most recently is right for one window and silently wrong for two,
      so the embed is keyed on the app id the page names
- [x] **a real client's window shown through the native `<app>`.**
      `guard-shell.sh` on `crux`, with both shells: `engine found #FF19B36B
      over (0,63) 640x473 of the browser's 1600x1200 window`. The shells write
      the fork's own tag, so the embed runs through `HTMLAppElement::Embed`.

      **It took a fix to get there, and the fix was one line per element.**
      Neither `HTMLAppElement` nor `HTMLWebViewElement` overrode
      `Node::GetElementType`, so both answered `kHTMLElement` and the generated
      `DowncastTraits` — which compares against `kHTMLAppElement` — refused
      every cast. `LayoutAppSurface::UpdateAfterLayout` casts the node back to
      hand the element its box; the cast returned null, `SurfaceBoxChanged` was
      never called, and `Embed()` returned at its empty-size guard on every
      layout. Everything a page can see was right: the element parsed, took a
      box at the right size, and reflected `app-id`. Nothing in any log said
      otherwise, because nothing had failed.
      `scripts/test-fork-elements-know-their-type.sh` is what stops the next
      element from shipping the same way
- [x] **the parity table re-taken through that tag.** The line above closed the
      element; this closes the evidence, which was the same gap one level up.
      `spike-css-page.html` and `spike-resize-page.html` write
      `<app app-id="…">` now and call nothing. Not one number moved, and the
      resize row became layout-driven. See *What CSS does to an `<app>`*.
      `scripts/test-parity-page-uses-the-native-tag.sh` is the guard, in the
      shell group because drift here fails nothing on its own
- [ ] **an shm→dmabuf upload.** `publish_frame` submits only
      `CommittedBuffer::Gpu`, so a client that draws into shared memory — most
      toolkits that do not render with GL — has no window.

      **Settled by the project owner, against the recommendation:** the upload
      is not a prerequisite, the copy path went first, and shm clients are
      broken in the interim. Nothing is released, so the regression costs
      nothing real, and one path to write the upload against is worth more than
      an interim tree that works.

      Deliberate and time-boxed rather than a change of mind: a shipped desktop
      that silently shows no window is still the defect ERRORS.md is about.
      `publish_frame` refuses a non-dmabuf buffer once per client and says so.
      The box closes when the upload exists, not when the message does.
- [x] **an arrival stamp on the control channel's events.** Every
      `ControlChannelClient` method carries a `mojo_base.mojom.TimeTicks
      arrival`, taken in `ControlChannel::OnRead` — once per read, not per
      line — and `DomicileHost::Arrival` puts it on the document's clock, so
      `event.timeStamp - event.arrival` is the stage. `Displays` is the one
      without one: it dispatches a bare `Event` and there is nothing to hang it
      on. **Measured:** `guard-control-arrival.sh` drives three lines down a
      real control socket and has the page print the subtraction, reading the
      stamp's shape as well as its value — a stamp nobody fills in reports a
      plausible hop, which is how the deleted instrument printed `ipc_ms=0`
      every interval. The SDK's window for it is still gone; rebuilding an
      instrument is the item below, and this is the number it was missing.
- [x] **rebuild the latency measurement** in the compositor (#206). It is the
      one process that both puts the key into the client's seat and holds the
      engine connection that knows when viz presented; a page can see the first
      and a producer the second. `latency.rs` is the compositor half and
      `guard-latency.sh` drives it. **The box closed on a number**: 28–29 ms
      commit to pixel against a 16.67 ms display frame, 1.7 frames, on every
      run there has been. See *Keystroke to pixel*. What is left is presentation
      on a screen, which is phase 3's.

Phase 3 — be the display server:

- [x] **Ozone/DRM instead of a nested backend.** `ozone_platform_drm = true` is
      in the build, a connector modesets, and the desktop draws on it —
      `engine-9dd6e30` is the release that first did, and #379 is the patch
      that made it happen at startup rather than after a console switch. That
      work is `docs/architecture/A-DESKTOP-ON-A-TTY.md`, patches `0012`–`0024`,
      and it is where what remains of it is tracked — not here.
- [ ] **presentation, measured.** Everything in this doc reads pixels back out
      of a `CopyOutputRequest`. Nothing yet reads a lit CRTC, so overlay
      promotion, damage and the presentation half of latency are all still
      unmeasured.

## `domicile://` serves the shell, and no port is open

A shell is a page inside our Chromium, and its JavaScript needs an origin:
`file:` has none — no WebSocket, restricted `fetch` — and JavaScript cannot
open a unix socket. The answer is a scheme, not a server. Patches `0008` and
`0009`.

**`domicile://shell/` is a standard scheme, deliberately neither web-safe nor
CORS-enabled**, so it has a real origin and ordinary web content can neither
navigate to it nor fetch it. `ContentClient::AddAdditionalSchemes` is the
registry seam. The loader takes two `ContentBrowserClient` hooks that do not
have the same shape as each other:

- navigation: `CreateNonNetworkNavigationURLLoaderFactory(const std::string&
  scheme, FrameTreeNodeId)`, which is asked about *one* scheme and returns a
  single `PendingRemote`.
- subresources: `RegisterNonNetworkSubresourceURLLoaderFactories`, which takes
  a map and fills it.

`--domicile-shell-root` and `--domicile-shell-module` say what to serve, the
same shape as `--domicile-broker-socket`.

**The shell's document is written by the fork**, in
`components/domicile/browser/shell_url_loader_factory.cc`, and it has three
properties on purpose: a charset, because a page without one is decoded by
guesswork; a viewport, because without it the engine lays out for a phone; and
a root with no margin, because *eight pixels of default body margin is eight
pixels the compositor believes it has and does not*.

**The control channel is a binding, not a socket the page opens.** The engine
process already holds a unix socket to the compositor —
`--domicile-control-socket`, beside `--domicile-broker-socket` — and the page
reaches it through `window.domicile` rather than through a channel of its own.
Patch `0002` is the precedent for exposing something to the page at all, and
`0004` for opening a unix socket at browser startup.

### Why there is no port, and why an origin check would not have done

This is the reason not to put a loopback server back the next time something
needs a page and a channel at once.

The shell used to be served from `http://127.0.0.1:<kernel-chosen>` with a
WebSocket beside it, and that WebSocket was a byte pipe to the compositor's
control socket. `ChromeMessage` carries `Spawn { command }` — arbitrary
commands on the machine running the desktop — plus synthetic `Key` and
`PointerButton` into any window, and returns `AppTitled`, `Displays` and
`Modifiers`: every window title and every keystroke. **It was the desktop's
control plane**, not a page server with a socket beside it.

A WebSocket is not stopped by CORS — the browser sends `Origin` and the server
has to refuse it — so before an origin check existed, any page in any browser
on the machine could scan a few thousand ephemeral ports, find this one and
take the desktop. Measured, against the real `serveShell`: an upgrade carrying
`Origin: https://evil.example` was accepted and `{"type":"spawn",…}` reached
the compositor socket unaltered. **And the origin check only closed half**: a
loopback port is reachable by every process on the machine and `curl` forges
any header in one flag. No header fixes that; not having a port does.

So `engine-chrome-host` — the HTTP server, the WebSocket, the port and the
origin check guarding it — was deleted rather than hardened, and the package
went with it. The only thing left to connect to is the compositor's socket
under `XDG_RUNTIME_DIR`, which is mode 700 and the user's.

## Open questions

- **Input.** `SurfaceLayer::SetSurfaceHitTestable` exists and viz has a
  hit-test path, but Domicile already routes input and knows the client. The
  recommendation is to keep our routing and let the page report the box, which
  is what it does today — but whether viz's hit-test data has to agree with
  ours to avoid the engine swallowing events is not established.
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
  ~6s per subsequent edit. **The series has grown since those four figures were
  taken**, so read them as the shape rather than today's stopwatch. What has
  not changed is that it is additive and its deps run one way, from Chromium's
  targets into `//components/domicile:*`.

  **The rebase number, measured once.** The first roll was three weeks of
  upstream — `bbbfd22` (2026-08-29) to `3d77360` — and it cost **three of
  thirty-five patches**:

  | Patch | What upstream moved | What it took |
  |---|---|---|
  | `0001` | renamed `session_storage_namespace_impl` to `..._handle_impl` in `//content/browser`'s source list | keep their spelling, re-sort ours beside it |
  | `0007` | added `kHTMLPersistentWidgetElement` to the `HTMLFrameOwnerElement` fall-through in `StyleAdjuster` | keep both case labels |
  | `0011` | gave `Element::SetFocused` a third argument, `BlurEventBehavior` | override the new virtual and forward it — **and in `src/` too**, where `<webview>`'s own override had the old signature |

  The other thirty-two applied with `git am -3` untouched, which is the
  additive design paying out: the twenty-four DRM patches, the ones that edit
  most of Chromium's own files, took nothing. **The one to learn from is
  `0011`**: a signature change reaches `src/` as well as `patches/`, and `src/`
  is a copy that no `git am` will ever reject. A roll that only counts
  rejected hunks will miss it and fail at the compiler instead.

  Moving the pin no longer needs anybody on `crux`: the engine workflows fetch
  the revision and `gclient sync` the checkout onto it themselves, so a repin
  is a pull request. See `packages/domicile-engine/README.md`'s *Moving the
  pin*. The rebuild cost is still upstream's rather than the fork's: whatever a
  three-week upstream diff costs to rebuild, carrying this adds seconds to it.
- **Nothing invalidates a renderer's token when a producer goes away.** The map
  above is keyed on an app id, and app ids are minted from a counter that
  starts over when the compositor restarts. So a compositor restarting under a
  running browser gets `app-1` brokered a new `FrameSinkId` while the page
  still holds `app-1`'s old token, and every embed of it is refused from then
  on. The browser knows when a producer disconnects — `OnProducerDisconnected`
  drops its sinks — and does not tell the renderer. Phase 1's, and it is the
  reload case a shell hits first.
