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

Step 1 of the spike in `ENGINE-FORK.md`: a browser-process service that
allocates a `FrameSinkId` and creates a `CompositorFrameSink` for a client that
is not a renderer. It was not killed — `ENGINE-FORK.md`'s *Who may create a
frame sink* has the evidence.

| | |
|---|---|
| `components/domicile/mojom/frame_sink_broker.mojom` | the interface a non-renderer producer calls |
| `components/domicile/browser/frame_sink_broker.{h,cc}` | the service. Takes its `HostFrameSinkManager` and its `FrameSinkId` allocator from the embedder, so it needs no `//content` and no browser to test |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | one registered `FrameSinkId`, held for as long as the producer submits to it |
| `components/domicile/browser/frame_sink_broker_unittest.cc` | four tests, against a real `HostFrameSinkManager` and an in-process `FrameSinkManagerImpl` |
| `content/browser/domicile/domicile_frame_sink_broker.{h,cc}` | the browser process's one instance, wired to `content::GetHostFrameSinkManager()` and `content::AllocateFrameSinkId()` |

Nothing binds the interface across a process boundary yet. That is step 2's
job — the transport is what the throwaway external submitter needs, and
building it before there is anything to connect would ship code no test runs.

Run the tests with:

```sh
autoninja -C out/Domicile components_unittests
./out/Domicile/components_unittests --gtest_filter='FrameSinkBroker*'
```
