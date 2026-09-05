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
a page embedded us: LocalSurfaceId(1, 1, 9A4E...) at 640x480
BeginFrames are flowing
aggregated: drew #FF00C853, submitted #FF00C853
```

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

**The reply waits for a producer, and that removed the startup hook.** An
`<app>` element exists before the client window behind it does, so a page that
embeds early is held rather than failed, and is answered when a producer
connects. Which means nothing has to be started at browser startup: the broker
and its socket are created when a page first asks. Step 2's one line in
`browser_main_loop.cc` is gone and nothing replaced it.

One thing binding it from a free function costs, and it is worth stating rather
than discovering later: **the browser does not check that the renderer owns the
parent frame sink it names.** That is the check
`EmbeddedFrameSinkProviderImpl` makes against its `renderer_client_id_`, and
making it needs the calling renderer's child process id, which means binding
`ExternalSurfaceProvider` through `RenderProcessHostImpl` rather than as a free
function. The cost is one more edited file, and it is not a spike's to pay.

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
| Getting the producer to the broker | `mojo::NamedPlatformChannel` + a real invitation | **done** — see *How the producer reaches the broker*. No edited file: the socket opens when a page first asks to embed, so it hangs off the same lazily-created service |
| Pushing the `SurfaceId` to the page | `components/domicile/mojom/external_surface.mojom`, modelled on the `RemoteFrame` path | **done** — new files, plus one binder line in `render_process_host_impl_receiver_bindings.cc` |
| An element that embeds it | `HTMLCanvasElement`, which already owns a `SurfaceLayerBridge` and a `cc::SurfaceLayer` for `transferControlToOffscreen` | **done** — `canvas.embedExternalSurface()`, 2 files + IDL as guessed, plus the flag and one `BUILD.gn` |

## Why this meets the requirements

| Requirement | How |
|---|---|
| **Latency parity** | The client's dmabuf becomes a `SharedImage` and rides in a texture quad. Viz aggregates it into the display frame — the same single composite any Wayland compositor does — and its `OverlayProcessor` can promote the quad to direct scanout. No readback, no socket, no `putImageData` |
| **CSS parity** | The window is a `cc::Layer`. Whatever CSS works on a hardware-composited `<video>` works, because it is the same layer type through the same property trees. This is the requirement's own wording — "just like a `<webview>` or `<iframe>` or `<video>`" — met by using literally that mechanism |
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
  the page half existed; measured, with steps 1–3 landed, it is **eight**, five
  of them Blink's:

  | | |
  |---|---|
  | `components/BUILD.gn`, `content/browser/BUILD.gn` | source lists and deps |
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
| The vendored exo protocols and `--experiment-augmenter` | The engine is no longer a Wayland client of ours |
| Electron | We ship the fork |

Kept: the Wayland server itself, input and seat handling, the output/config
model, the session, and the host brain. That is most of what is hard.

## Getting started

The spike proves the seam before anything is scrapped. It cannot be run on the
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
- [ ] **the measurement**: drive the colour from the page, then read `z-index`
      against ordinary DOM, `transform`, `border-radius`, `opacity`,
      `filter: blur()`, `mix-blend-mode`, and the added latency against a plain
      Wayland compositor

The last one is the whole point. The three before it are plumbing that either
works or names its own blocker. **Nothing is deleted from Domicile until the
measurement passes.**

## Plan

Phase 1 — real pixels:

- [ ] port `exo::Buffer`'s dmabuf → `SharedImage` → `TransferableResource`
- [ ] `domicile-compositor` submits a client's buffer instead of reading it back
- [ ] the embedder's `LocalSurfaceId` drives `xdg_toplevel.configure`

Phase 2 — collect the winnings:

- [ ] delete bands, the copy path, `AppFrame`, the measure loop, the shaders
- [ ] `<domicile-app>` becomes a `<canvas>` and one call

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
- **Not verified by measurement.** Five of the seven properties are still read
  from the mechanism rather than observed. Step 3's control moved the canvas
  with CSS and the producer's surface moved with it, which settles position and
  size; `z-index`, `transform`, `border-radius`, `opacity`, `filter: blur()`
  and `mix-blend-mode` are step 4's, along with the latency number. Nothing is
  deleted from Domicile until it passes.
