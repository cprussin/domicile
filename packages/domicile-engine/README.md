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
| `scripts/spike.sh` | run one step of the spike end to end; the producer's exit code is the verdict |
| `scripts/spike-page.html` | steps 2 and 3's page: a `<canvas>` that embeds instead of drawing |
| `scripts/spike-step4.sh` | the measurement: seven CSS properties and the latency |
| `scripts/spike-css-page.html` | its page — each property on an `<app>` and on a `<div>` beside it |
| `scripts/spike-resize-page.html` | the resize cell, which needs a page to itself |

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

`build.sh`, `spike.sh` and `spike-step4.sh` all have to run inside Chromium's
own toolchain shell — a component build links against that shell's glibc and
will not start without it:

```sh
NIX_SHELL_RUN="$PWD/scripts/spike-step4.sh /build/chromium/src" \
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

The spike in `ENGINE-FORK.md` is finished. All four steps, none killed: a
process the browser did not launch gets a frame sink from the browser's own
namespace, a `<canvas>` in an ordinary web page embeds the surface it submits
to, and CSS treats that canvas the way it treats any other element.

**Step 4 is the one that matters.** `spike-step4.sh` lays each property out
twice — once on an `<app>` and once on an ordinary `<div>` beside it — and
compares the two halves pixel for pixel out of the display compositor's own
draw:

```
$ ... scripts/spike-step4.sh /build/chromium/src
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

`z-index` is the property bands failed at and the reason the fork exists; it is
exact. `transform` differs on a one-pixel outline, which is a surface being
resampled where a `<div>` is rasterised, and is what a composited `<video>`
does too. `in effect` is the check that stops a property that never reached the
page from passing as parity, and the last row is the check that stops a diff
that cannot see a difference from passing at all.

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
| `content/browser/domicile/domicile_frame_sink_broker.{h,cc}` | the browser process's one instance, wired to `content::GetHostFrameSinkManager()` and `content::AllocateFrameSinkId()`, and the named socket a producer reaches it over |
| `third_party/blink/renderer/platform/graphics/external_surface_embedder.{h,cc}` | the page's half: allocates the `LocalSurfaceId`, asks the browser for the `FrameSinkId`, pairs them |

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

Nothing hooks browser startup. The broker, its socket and the probe are created
when a page first calls `embedExternalSurface()`, and the browser holds that
page's request until a producer connects — an `<app>` element exists before the
client window behind it does. Step 2's one line in `browser_main_loop.cc` is
gone.

The series edits eight files Chromium owns; `ENGINE-FORK.md`'s *Minimise edited
files* has the list and what each is for.

Run the tests with:

```sh
autoninja -C out/Domicile components_unittests
./out/Domicile/components_unittests --gtest_filter='FrameSinkBroker*:WindowDiff*'
```

Neither the Blink half nor the probe has a unit test. Chromium does not unit
test `SurfaceLayerBridge` either — there is no `surface_layer_bridge_test.cc` —
and for the same reason: the seam only means anything with a display
compositor behind it. `spike.sh` and `spike-step4.sh` are what cover them, and
their exit codes are the assertion.
