# Stacking parity for `<app>`: what is known

**This doc is context, not a design.** It exists so the next person to pick
this up does not re-run experiments that have already been run. It records the
requirement, what is built and working, what does not work and why, and every
route that has been closed with the evidence that closed it. The design that
comes out of it belongs in a doc of its own; this one gets deleted when that
one lands.

## The requirement

Three, stated by the project owner, in order of how much they constrain:

1. **Latency parity.** "For a native wayland window, the user should see nearly
   NO added latency caused by the compositor. If we need to muck with the
   Chromium internals more to make that happen, then so be it. Trading this off
   is unacceptable."
2. **CSS parity.** "Native wayland windows MUST behave just like a `<webview>`
   or `<iframe>` or `<video>` or any other replaced element. ANY css that
   behaves differently for `<app>` elements from any other css element is
   unacceptable and is a failure." `z-index` is the case that fails today.
3. **Shell simplicity.** A React developer gets a working shell from "a few
   simple lines wrapping `ReactDOM.render`", with nothing framework-specific in
   the SDK.

Scrapping Domicile in its current form is explicitly acceptable if that is what
requirements 1 and 2 cost.

## Where it stands

Requirement 1 is met on the native path and missed by ~35ms a frame on the copy
path. Requirement 2 is **not met**: `z-index` works between `<app>` elements
and works for opaque chrome above a window, and everything else is bought with
**bands**, which impose an authoring rule on the shell (`data-band` on every
painting element) and so break requirement 3 as well.

Bands are the thing to remove. Everything below is about what could replace
them.

## What works

| | where | note |
|---|---|---|
| Native path — client dmabuf imported and composited on the GPU, hole punched in the page | `compositor/src/main.rs`, `disposition()` | `Draw` when `from_gpu && presenting && draws_natively`. Zero copies. **Not reproducible in the dev container** — no DRM render node |
| Copy path — readback, socket, `putImageData` | same | ~11ms compositor + ~16ms chrome at ~1500x1000, ~80MB/s for one window, scaling as pixels². The fallback for `wl_shm` clients and for CSS the compositor cannot reproduce |
| Fractional scale | `compositor/src/scale.rs::desktop_size`, `compositor/src/viewport.rs` | `wp_viewporter` is honoured, not merely advertised: destination sizes the surface, source crops where the compositor draws. Held by `scripts/e2e-a-dense-display.sh` at 1.5x |
| Chrome ordered below a window | `compositor/src/stacking.rs`, `Layer::clip` | Correct only where the chrome *above* the window is opaque — a translucent panel shows what is behind it through the window's hole |
| Bands — a raster per z-depth | `compositor/src/bands.rs`, `shell-manganese/src/bands.ts`, `domicile-protocol/src/band_label.rs` | `declare_bands` out, `render_band` back, the band number painted into the top-left pixel so a commit is attributable. Works. See "What does not work" |
| Several outputs | `Screens::entered_by` | Regions of Domicile's own window until the DRM/KMS backend exists. Config is watched and reloaded live |
| Protocols the engine asks for | `compositor/src/exo.rs`, `compositor/protocols/` | `wl_subcompositor`, `wp_viewporter`, `wp_single_pixel_buffer_manager_v1`, `wp_content_type_manager_v1`, `overlay_prioritizer`, `zcr_alpha_compositing_v1`. The last two are Chromium's own, vendored from `components/exo/wayland/protocol/` |

## What does not work

**Bands cost the shell contract.** Every element that paints must carry
`data-band`, because the compositor asks the page to render one depth at a time
and an unmarked element paints into every band. A shell author therefore cannot
write ordinary CSS and get an ordinary result, which is requirement 2 failing
and requirement 3 with it. The user's verdict: "living with bands is
unacceptable. It completely defeats the shell developer expectation that
z-indexing works like any other css, which is the core premise of the
compositor."

**A round trip per band, per chrome repaint.** Any repaint while a band is
outstanding carries the previous band's label, so the compositor drops the set
it holds and starts again. Correct, and visible as flashing.

**The copy path does not stack against other windows.** Escalating a window to
the copy path fixes chrome-vs-window (the engine draws it in the page at its
real `z-index`) and breaks window-vs-window, at ~35ms a frame.

**No `surface_augmenter` request is honoured.** It is advertised only under
`--experiment-augmenter`, which defaults off and is asserted off by
`domicile-launch/tests/arguments.rs`. It exists to have made the measurement
below and has no other reason to stay.

## Routes that are closed

Each row is a measurement or a source reading, not an opinion.

| Route | Verdict | Evidence |
|---|---|---|
| Get a client dmabuf **into** the page as a texture | **No API.** CEF's dmabuf support runs page-out only (`OnAcceleratedPaint`), never client-in | `WINDOW-COMPOSITING.md`, "The finding that decides it" |
| `<video>` / Media Source as the import | Chromium's zero-copy video path wants frames made *inside its own GPU process* via `GpuMemoryBuffer` | same |
| WebGPU `importExternalTexture()` | Takes an `HTMLVideoElement`, so it reduces to the row above | same |
| `OnAcceleratedPaint` as the layer tree | Emits **one** composited texture — the same flat raster | same |
| Delegated compositing (`WaylandOverlayDelegation`) | **Measured, negative.** With every protocol the engine asks for implemented, a 600x400 page arrives as a single 632x442 buffer whether it has 1 or 8 composited layers, and `place_above`/`place_below` are never called. A delegated *root*, not a delegated tree | `scripts/probe-delegated-compositing.sh`; table in `WINDOW-COMPOSITING.md` |
| Colour management as the thing blocking promotion | **Exonerated.** With the engine's own `WaylandWpColorManagerV1` off, so `wp_color_management_surface_v1` is out of the question, the counts are unchanged | same probe, fourth run |
| `surface-augmenter` as the exo-shaped-compositor gate | **Declined.** Advertised, and the engine never binds it — and a client binds what it wants at registry enumeration, before it renders. It is not looking for an augmenter | commit `8a1616e`; probe's augmenter section |
| Lift `components/exo` out of the tree | `assert(is_chromeos)` in its `BUILD.gn`, and it is bound to ash/aura/viz throughout. Not a standalone compositor | `components/exo/BUILD.gn` |

The premise that made all of this worth trying — that Chromium already emits
its layer tree as Wayland surfaces and only needed a compositor to accept it —
is **false for the engine as it ships**. That is what reopened the fork
question.

## Reproducing the measurements

```sh
nix run .#probe-delegated-compositing    # four engine runs + wire report + verdict
nix run .#e2e-a-dense-display            # the fractional-scale regression
nix run .#smoke-compositor               # asserts the advertised globals
```

The probe needs **a DRM render node**. This dev container has none, so the GPU
process exits during init, there is no Viz compositor to delegate from, and no
amount of protocol produces a quad:

```
WARNING wayland_buffer_manager_gpu.cc:456] Failed to initialize drm render node handle.
ERROR   viz_main_impl.cc:189] Exiting GPU process due to errors during initialization
```

Every delegation number in this doc came from a machine with a GPU. Nothing
about the native draw path can be exercised here either.

Environment, for the next agent:

- `ulimit -n 8192` before `bun`, or it runs out of descriptors.
- `nix --extra-experimental-features 'nix-command flakes'` here; export
  `NIX_CONFIG="experimental-features = nix-command flakes"` for child processes.
- `XDG_RUNTIME_DIR` must be short — the socket path has a length limit.
- Register every new script in `flake.nix`, or `nix run` will not find it.
- Run `cargo fmt --check` **before** pushing; CI has caught it twice.

## Instrumenting Chromium: what is and is not true

Hard-won, and every one of these produced a wrong conclusion first.

- **`--enable-features` and `--disable-features` silently ignore unknown
  names.** A run with a misspelled feature looks exactly like a run with the
  feature having no effect. Verify every name against the shipped binary before
  trusting a result.
- **`strings` on the binary is sound for feature names and unsound for protocol
  interface names.** `wp_viewporter` reads zero occurrences and is nonetheless
  used.
- **`--vmodule` reaches `VLOG` only.** `DVLOG` is compiled out of a release
  Electron, so the engine cannot be made to explain a promotion decision.
  Read the wire (`WAYLAND_DEBUG=1`) instead of asking the log.
- **Wire object ids are `wl_buffer#31`, not `wl_buffer@31`.** A pattern
  assuming `@` reports zero buffers on every trace.
- **`delegat` over-matches** — `NetworkDelegate`, `initializing 0 fork
  delegates`, and the probe's own config directory. Match on filename.

## Traps in this repo

- **A shell must paint no desktop background**, and `shell-manganese/src/bands.ts`
  says so at length. On the composited path a band-0 background goes *behind*
  every window and fills the holes the clients show through: a whole desktop
  hidden behind its own wallpaper. This was shipped once and reverted (`#170`).
- **Advertising a Wayland global is a promise to honour what clients say through
  it.** `wp_viewporter` advertised while the commit path ignored the destination
  made every surface twice its logical size at any scale above 1x — the desktop
  drawn at double, every portal and pointer coordinate out by the same factor.
  At 1x the two forms coincide, which is why nothing headless caught it.
- **`pkill -f <pattern>` matches the invoking shell's own command line.** Put
  kills in a script file and split the string literal.

## Reading Chromium source from this container

`chromium.googlesource.com` and `source.chromium.org` are **blocked by the
egress proxy** (403 on CONNECT). `raw.githubusercontent.com` answers, but the
GitHub mirror is outside this session's repository scope, so reading it needs
`add_repo` for the mirror first — or a local checkout.

## What is left

The fork. The question is the cheapest shape of it that meets requirements 1
and 2, and it is open.

The working hypothesis, **not yet verified against source**: the mechanism to
reuse is not `cc::LayerTreeHost` but the one an out-of-process `<iframe>` and a
hardware-decoded `<video>` already use — a `SurfaceLayer` referencing a viz
`SurfaceId` produced elsewhere. That path gives full CSS by construction, since
the layer participates in the page's own compositing, and composites on the GPU
without a copy. `components/exo` is the existing proof that a Wayland client's
buffer can become a viz surface inside Chromium; what it is not is liftable.

What would confirm or kill it: how OOPIF and `<video>` bind a foreign viz
surface into a page's layer tree, what `assert(is_chromeos)` actually gates in
`components/exo`, and what a fork of that shape costs per Chromium release.
