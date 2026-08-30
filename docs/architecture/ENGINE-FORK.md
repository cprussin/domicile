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

### The pieces

| Piece | Where | New or edited |
|---|---|---|
| Wayland server, input, seat, outputs, session | `domicile-compositor` as it stands | **kept** |
| dmabuf → `gpu::SharedImageInterface::CreateSharedImage` → `viz::TransferableResource` | ported from `components/exo/buffer.cc` | new |
| Submitting `CompositorFrame`s for a sink | new external viz client | new |
| Brokering a `FrameSinkId` and sink to a non-renderer process | new browser-process service, modelled on `content/browser/renderer_host/embedded_frame_sink_provider_impl.cc` | new file + ~1 line in `render_process_host_impl_receiver_bindings.cc` |
| Pushing the `SurfaceId` to the page | new mojo, modelled on the `RemoteFrame` path | new |
| An element that embeds it | `HTMLCanvasElement`, which already owns a `SurfaceLayerBridge` and a `cc::SurfaceLayer` for `transferControlToOffscreen` | edited (2 files + IDL) |

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
  and new files do not conflict. The design above edits Chromium in roughly
  **four places**; everything else is additive.

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
build with no symbols, and every Ozone platform off but Wayland:

```sh
gn gen out/Domicile --args='
  is_debug = false
  symbol_level = 0
  is_component_build = true
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_wayland = true
'
autoninja -C out/Domicile chrome
./out/Domicile/chrome --ozone-platform=wayland
```

Phase 3 swaps `ozone_platform_wayland` for `ozone_platform_drm`; nothing else
about the build changes.

**The spike**, each step naming what would kill it:

- [ ] a browser-process service that allocates a `FrameSinkId` and creates a
      `CompositorFrameSink` through `viz::HostFrameSinkManager` for a client
      that is not a renderer — killed if that privilege turns out to be
      reachable only from inside the browser's own object graph
- [ ] a throwaway external submitter pushing solid-colour `CompositorFrame`s to
      it — killed if frames are accepted but never aggregated, meaning
      hierarchy registration is not enough
- [ ] `canvas.embedExternalSurface()` behind a runtime flag, calling
      `SurfaceLayer::SetSurfaceId` with the brokered id — killed if the canvas
      refuses a surface it did not itself allocate
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
  for free. Recommendation: external, and revisit only if the brokering turns
  out to need privileges an external process cannot be given.
- **Build and CI cost.** Half answered: a from-scratch build is 4h 16m and
  97 GB on one 16-core machine, which is an afternoon rather than a build farm,
  and cheap enough that carrying a fork is not obviously unaffordable. The half
  that decides it is the **incremental** rebuild after a rebase onto a new
  Chromium release — a full rebuild every six weeks is a different proposition
  from a partial one. Measure that at the first rebase. This repo's CI still
  will not carry either.
- **Not verified by measurement.** Every claim above about what CSS applies is
  read from the mechanism, not observed. The spike's last step is what turns
  it into a fact.
