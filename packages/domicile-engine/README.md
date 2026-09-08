# domicile-engine

The Chromium fork, carried as a patch series rather than a fork of the tree.

`docs/architecture/ENGINE-FORK.md` is why this exists and what it is for; read
it first. In one line: `<app>` becomes a `cc::SurfaceLayer` embedding a viz
surface the compositor submits, so CSS applies to a window structurally instead
of being reimplemented in a shader.

## Why a series and not a fork

The design is deliberately **additive** — a browser-side broker, a mojo
interface, and one method on `HTMLCanvasElement` — so most of it is new files,
and new files never conflict. Carrying that as a 40 GB fork of `chromium/src`
would hide the only number that matters, which is how much of it *does*
conflict when Chromium moves. Here that number is countable: bump
`CHROMIUM_PIN`, run `apply.sh`, count what rejects.

Electron and ungoogled-chromium carry their downstreams the same way, for the
same reason.

## Layout

| | |
|---|---|
| `CHROMIUM_PIN` | the exact revision the series applies to. One line |
| `src/` | new files, laid into the checkout as-is. The bulk of the fork |
| `patches/` | `git format-patch` output for edits to files Chromium already owns. Kept small on purpose |
| `scripts/apply.sh` | series → checkout |
| `scripts/extract.sh` | checkout → series. Run before every push |
| `scripts/build.sh` | `gn gen` + `autoninja` with the args the spike is measured under |
| `scripts/under-wayland.sh` | runs another script under a nested wlroots compositor on the GPU — the only platform that can import a dmabuf. Every guard below runs under it |
| `scripts/guard-client-window.sh` | a real Wayland client's window on the page, and the colour it drew coming back out |
| `scripts/guard-two-windows.sh`, `guard-two-windows.html` | two clients, two windows, one page — two `SurfaceDrawQuad`s in one aggregation |
| `scripts/guard-shell.sh` | a real shell, built by its own vite config and joined by the SDK, with a client's window in it |
| `scripts/guard-css-and-resize.sh` | the measurement: seven CSS properties, the resize, and the latency |
| `scripts/spike.sh` | run one step of the spike end to end; the producer's exit code is the verdict. What `guard-css-and-resize.sh` runs twice |
| `scripts/spike-page.html` | steps 2 and 3's page: a `<canvas>` that embeds instead of drawing |
| `scripts/spike-css-page.html` | the CSS half's page — each property on an `<app>` and on a `<div>` beside it |
| `scripts/spike-resize-page.html` | the resize cell, which needs a page to itself |
| `scripts/spike-engine.sh` | phase 1's library, end to end, from a C process. Run by hand, not by CI |
| `scripts/spike-dmabuf.sh` | a real dmabuf, imported, submitted and released. By hand, always under `under-wayland.sh` |
| `scripts/spike-iframe.sh`, `spike-iframe-page.html`, `spike-iframe-inner.html` | an `<app>` against an out-of-process `<iframe>`, over HTTP so the iframe can be cross-site. By hand |

## Getting one without building it

Building the fork is a Chromium checkout and about four hours, which is not
what running a desktop should cost. So CI publishes a build and the flake
fetches it:

```sh
nix build .#engine
```

That pulls a few hundred megabytes into the store once, checks it against the
hash in `engine-release.nix`, and patches it to run — which is what makes it
work on NixOS, where a generic-linux Chromium cannot start at all.
`/scripts/update-engine-release.sh` moves that file to the newest release, so
**which engine a given revision runs is a commit you can read.**

`DOMICILE_ENGINE` points `domicile` at a different one — a checkout's
`out/Domicile`, say. It names the directory holding `chrome`.

## Working on it

This is built on a machine with a Chromium checkout — `crux`, at
`/build/chromium/src`. It cannot be built anywhere else in this project, and
**it cannot be built by this repo's CI**: a green check on a change to this
package means the scripts linted, not that the series still applies. Treat CI
here as spell-check, never as proof.

```sh
./scripts/apply.sh   /build/chromium/src     # lay the series down
./scripts/build.sh   /build/chromium/src     # gn gen + autoninja
# ... work in the checkout, commit there ...
./scripts/extract.sh /build/chromium/src     # write it back here
```

### The checkout is scratch, and you are not alone in it

The loop above is right when one person is on the box. It is a trap when two
are, and both of these have already happened rather than been imagined:

- **CI resets that tree.** `engine.yml` and `engine-release.yml` reset
  `/build/chromium/src` to the pin and lay the series over it, and they trigger
  on any push touching `packages/domicile-engine/**` — which is every push
  either agent makes to the fork. Uncommitted work in the checkout is taken
  without warning. Take the lock around builds:
  `.github/scripts/engine-tree-lock.sh take /build/chromium/src "<who>"`, and
  drop it with the same owner string when you are done.
- **A file in the checkout with no counterpart in `src/` wedges the next run.**
  The reset removes the series' own files by walking `src/`, so anything not
  mirrored there survives, and `apply.sh` then refuses the dirty tree. The
  failure lands on somebody else's unrelated PR.

So: **write in this repo, compile in the checkout.** New files go into `src/`
at their mirrored path in the same change that creates them; edits to files
Chromium owns become patches via `extract.sh`. Then a reset costs you a re-run
of `apply.sh` and nothing else, which is the whole reason the series exists.

`build.sh`, `spike.sh` and `guard-css-and-resize.sh` all have to run inside
Chromium's own toolchain shell — a component build links against that shell's glibc and
will not start without it:

```sh
NIX_SHELL_RUN="$PWD/scripts/guard-css-and-resize.sh /build/chromium/src" \
  nix-shell /build/chromium/src/tools/nix/shell.nix
```

`apply.sh` ends in `git am`, so the checkout needs a committer identity or the
patches fail with `unable to auto-detect email address` — a fresh `fetch`
leaves none:

```sh
git -C /build/chromium/src config user.name  "..."
git -C /build/chromium/src config user.email "..."
```

`extract.sh` regenerates `patches/` from the commits on top of the pin. It
cannot tell a new source file from build output, so **new files are copied into
`src/` by hand** — that is the one manual step and it is deliberate.

The rule the whole arrangement exists to enforce: work that is only in the
checkout does not exist. Extract and push, or it is lost with the machine.

## Measured

From a cold, from-scratch build on `crux` — 16 cores, no remote execution, no
cache:

| | |
|---|---|
| wall clock | 4h 16m, 56,376 steps at 3.67/s |
| CPU | 3450m user against 256m wall — ~13.5× parallel |
| disk | 97 GB for `depot_tools`, the checkout and `out/Domicile` together |
| toolchain | Chromium's own `tools/nix/shell.nix`, unaided |

Incremental, against a tree already built at the pin:

| | |
|---|---|
| null build — ninja stats 56k targets, nothing to do | 6–7s |
| apply the whole series to a built tree, `autoninja chrome` | 65s |
| edit one of the series' own files → `chrome` | 13–14s |

Net of the floor that is ~1m to lay the series down — `gn` regen, the mojom
generation, three objects, and relinking `libcontent.so` and `chrome` — and ~6s
per subsequent edit. The rebase number is still missing: it needs
`CHROMIUM_PIN` rolled onto a later revision, and that has not happened. See
`ENGINE-FORK.md`'s *Build and CI cost*.

## State

The spike in `ENGINE-FORK.md` is finished and **phase 1 is under way**: the C
ABI library is built and proven, and the dmabuf import behind it is blocked on
a named thing rather than an unknown one. See `ENGINE-FORK.md`'s *Why
`domicile_surface_import` cannot be written yet*.

Two things that were assumed and are not true:

- **`crux` has a GPU** — a GTX 970 on the proprietary driver, and Chromium
  drives it. `--disable-gpu` everywhere was a missing `libEGL.so.1` on the
  toolchain shell's path, not the absence of hardware. `GPU=1` on any of the
  spike scripts turns it on, and `scripts/e2e-dmabuf.sh` **passes** here rather
  than skipping.
- **On the GPU, an `<app>` is bit-exact against an ordinary element for every
  property, `transform` included.** Step 4's one imperfect cell was software
  rasterisation. An out-of-process `<iframe>` is the thing that is *not*
  pixel-identical to a `<div>`.
- **A dmabuf can be imported on this machine**, under
  `scripts/under-wayland.sh` — `--ozone-platform=wayland` nested in a headless
  wlroots compositor. NVIDIA ships its own GBM backend and its EGL imports
  dmabufs, so Chromium's GBM path does not assume Mesa. Weston's headless
  backend cannot be used for it: it advertises no `zwp_linux_dmabuf_v1`.

- **The producer submits its own frames.** The browser imports the dmabuf and
  hands back a `gpu::ExportedSharedImage` — a mailbox and a verified sync token
  — and the producer builds its own `TransferableResource` and submits straight
  to viz. Viz accepts a resource whose `SharedImage` another client created, and
  returns it through the producer's own sink. The per-buffer hop stays, the
  per-frame hop is gone, and no GPU channel moves.
- **A dmabuf now reaches the page.** `scripts/spike-dmabuf.sh` allocates two
  buffers on the render node, imports them through the C ABI, submits one and
  then the other, and `released` fires for the first — `wl_buffer.release`, the
  first time it has. The producer never sees a mailbox: the browser does the
  import and builds the frame, which is why the `exo::Buffer` port lives in
  `components/domicile/browser/`.

Two things that shape the assertion, both measured. **On this GPU a buffer is
CPU-writable or sampleable, never both** — NVIDIA's gbm refuses
`rendering|linear`, and a linear buffer imports without error then draws as the
fallback. So the harness allocates a renderable one it cannot fill, and asserts
the pixel is the buffer's own zeroed content rather than the fallback.
`LINEAR=1` runs it the other way and fails, which is what documents the limit.
And **it takes two frames to see a release**, because viz holds whatever is on
screen — which is exactly why a Wayland client double-buffers.

`under-wayland.sh` suits checks that do not have to find the page by scanning
for a full-width row of its background colour, which is how the pixel checks
locate the viewport: under Wayland the browser window carries client-side
decorations and a shadow, so no row qualifies. The pixel checks stay on
`--ozone-platform=headless`, where the window is undecorated.

### The spike

All four steps, none killed: a
process the browser did not launch gets a frame sink from the browser's own
namespace, a `<canvas>` in an ordinary web page embeds the surface it submits
to, and CSS treats that canvas the way it treats any other element.

**Step 4 is the one that matters.** `guard-css-and-resize.sh` lays each property out
twice — once on an `<app>` and once on an ordinary `<div>` beside it — and
compares the two halves pixel for pixel out of the display compositor's own
draw:

```
$ ... scripts/guard-css-and-resize.sh /build/chromium/src
property             pixels   differ   interior    worst in effect  verdict
baseline              53200        0          0        1        no  pass
z-index               53200        0          0        0       yes  pass
transform             53200      285          0       84       yes  pass (edges only)
border-radius         53200        0          0        1       yes  pass
opacity               53200        0          0        2       yes  pass
filter: blur()        53200        0          0        1       yes  pass
mix-blend-mode        53200        0          0        1       yes  pass
negative control      53200    10800       9976      255        no  pass (differs, as it must)
```

**That run is `--disable-gpu`, and `transform`'s 285 pixels are the software
rasteriser rather than the mechanism.** `GPU=1 scripts/guard-css-and-resize.sh` on this
machine's card puts every cell at 0, `transform` included — which is the number
that describes what a user has. `z-index` is exact either way, and it is the
property bands failed at and the reason the fork exists.

`in effect` is the check that stops a property that never reached the page from
passing as parity, and the last row is the check that stops a diff that cannot
see a difference from passing at all.

Steps 2 and 3 are still `spike.sh`, and still a single pixel:

```
$ ... scripts/spike.sh /build/chromium/src -- --color=FF00C853
brokered frame sink: FrameSinkId(0, 2)
waiting for a page to embed it...
a page embedded us: LocalSurfaceId(1, 1, E8F6...) at 1024x681
BeginFrames are flowing
aggregated: drew #FF00C853, submitted #FF00C853
```

Kept:

| | |
|---|---|
| `components/domicile/mojom/frame_sink_broker.mojom` | the interface a non-renderer producer calls, plus `SurfaceObserver`, which is how it hears which surface an embedder chose for it |
| `components/domicile/mojom/external_surface.mojom` | the interface a *page* calls, which is one method wide and can only grant. A renderer never gets a `FrameSinkBroker` pipe |
| `components/domicile/browser/frame_sink_broker.{h,cc}` | the service. Takes its `HostFrameSinkManager` and its `FrameSinkId` allocator from the embedder, so it needs no `//content` and no browser to test |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | one registered `FrameSinkId`, held for as long as the producer submits to it |
| `components/domicile/browser/external_surface_provider.{h,cc}` | the renderer-facing shim over the broker |
| `components/domicile/browser/frame_sink_broker_unittest.cc` | nine tests, against a real `HostFrameSinkManager` and an in-process `FrameSinkManagerImpl` |
| `components/domicile/spike/window_diff_unittest.cc` | six, over the rule step 4's verdicts come out of: what counts as a difference, and what counts as an edge rather than a region |
| `components/domicile/engine/engine_event_queue_unittest.cc` | five, over the fd the compositor polls: that an idle queue does not wake it, that a burst arrives whole, and that a push racing a drain is not lost |
| `content/browser/domicile/domicile_frame_sink_broker.{h,cc}` | the browser process's one instance, wired to `content::GetHostFrameSinkManager()` and `content::AllocateFrameSinkId()`, and the named socket a producer reaches it over |
| `third_party/blink/renderer/platform/graphics/external_surface_embedder.{h,cc}` | the page's half: allocates the `LocalSurfaceId`, asks the browser for the `FrameSinkId`, pairs them |

Phase 1's library, which is not throwaway — it is the seam:

| | |
|---|---|
| `components/domicile/engine/domicile_engine.{h,cc}` | `libdomicile_engine.so`. The C ABI, the invitation, the broker pipe, and the pollable fd. The header is C, and `engine_smoke.c` is the compiler checking that |
| `components/domicile/engine/engine_event_queue.{h,cc}` | mojo's thread pushes, the compositor's thread drains, an eventfd in between. Five tests |
| `components/domicile/engine/engine_smoke.c` | what the library has to be able to do, asserted from C. Throwaway |
| `components/domicile/engine/engine_dmabuf_smoke.cc` | the same for a real dmabuf: allocate on the render node, import, submit twice, see the release. Throwaway |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | the `exo::Buffer` port. A dmabuf becomes a `SharedImage` and a `TransferableResource` here, in the browser, because that is where `aura::Env` is |

**Throwaway**, and deleted when `domicile-compositor` submits real buffers:

| | |
|---|---|
| `components/domicile/spike/surface_producer.{h,cc}` | the external producer. C++, in-tree, and that is a measured choice — see `ENGINE-FORK.md`'s *Rust: the bindings exist, the crate is not the seam* |
| `components/domicile/spike/solid_color_submitter.cc` | steps 2 and 3's assertion over it: one pixel at the centre of the window |
| `components/domicile/spike/css_parity.cc`, `css_parity_layout.h` | step 4's. The latency loop and the page's geometry, which has to stay in step with `scripts/spike-css-page.html` |
| `components/domicile/spike/window_diff.{h,cc}` | the rule that turns a picture of the window into step 4's verdicts. Separate from the process that takes the picture because every "pass" in the measurement is this code's opinion, and it has six tests |
| `components/domicile/spike/spike_color.{h,cc}` | comparing what viz drew with what was submitted, which every step ends in |
| `components/domicile/spike/mojom/spike_probe.mojom`, `content/browser/domicile/domicile_spike_probe.{h,cc}` | the pixel probe. A `CopyOutputRequest` on the browser's window, because the embedding layer belongs to the page now and there is no other way to keep the proof a pixel |
| `scripts/spike-page.html`, `spike-css-page.html`, `spike-resize-page.html` | the pages |

The broker is built at browser startup, from one line in
`browser_main_loop.cc`; its socket and the probe come with it only when
`--domicile-broker-socket` names a path, and a browser given none builds an
object that binds nothing and listens on nothing. A shell's page cannot embed
until a window exists and no window exists
until the compositor has connected over that socket, so opening it on a page's
first `embedExternalSurface()` was a deadlock. The browser still holds an
embed until a producer connects — an `<app>` element exists before the client
window behind it does — which is what makes it safe for a page to ask early.

The series edits nine files Chromium owns; `ENGINE-FORK.md`'s *Minimise edited
files* has the list and what each is for.

Run the tests with:

```sh
autoninja -C out/Domicile components_unittests
./out/Domicile/components_unittests \
  --gtest_filter='FrameSinkBroker*:WindowDiff*:EngineEventQueue*'
```

Neither the Blink half nor the probe has a unit test. Chromium does not unit
test `SurfaceLayerBridge` either — there is no `surface_layer_bridge_test.cc` —
and for the same reason: the seam only means anything with a display
compositor behind it. `spike.sh` and `guard-css-and-resize.sh` are what cover them, and
their exit codes are the assertion.
