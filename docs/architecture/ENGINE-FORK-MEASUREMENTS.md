# Engine fork measurements

The evidence behind [ENGINE-FORK.md](ENGINE-FORK.md) and the host shortcut
inhibitor in [ENGINE-BROWSER-BEHAVIOR.md](ENGINE-BROWSER-BEHAVIOR.md). All runs are on `crux`
(GTX 970, proprietary NVIDIA driver, no display connected). Scripts live in
`packages/domicile-engine/scripts/` unless noted.

Every pixel here is read back from a `CopyOutputRequest`, which forces the draw
it reads. Nothing measures presentation on a lit screen yet.

## Summary

| Claim | Result | Script |
|---|---|---|
| An external process's surface is drawn | yes, exact color | `spike.sh` |
| A page embeds a surface it did not allocate | yes, and it moves with CSS | `spike.sh` |
| CSS treats `<app>` like a `<div>` | bit-exact for 7 properties on the GPU | `guard-css-and-resize.sh` |
| A client frame adds a compositing stage | no, same frame as the page | `css_parity.cc` |
| Keystroke to pixel | 1.7 display frames (limit 2) | `guard-latency.sh` |
| A real Wayland client's window is on the page | yes, exact color | `guard-client-window.sh` |
| A dmabuf is imported and released | yes | `spike-dmabuf.sh` |
| The host honors the shortcut inhibitor | yes, on sway | `guard-shortcuts-inhibitor-chord.sh` |

## Getting a surface on screen

`solid_color_submitter.cc` runs as a process the browser did not launch. It
gets `FrameSinkId(0, 2)` from the broker and submits solid colors.

| Setup | BeginFrames | Aggregated |
|---|---|---|
| hierarchy + `SurfaceLayer` | yes | yes, drew the submitted color |
| `SurfaceLayer` only | no | yes, with a manual `BeginFrameAck` |
| hierarchy only | yes | no, nothing names the `SurfaceId` |

- `RegisterFrameSinkHierarchy` drives BeginFrames. A producer that does not
  need them can skip it.
- Aggregation needs an embedder naming the `SurfaceId` in a `SurfaceDrawQuad`.
- Proof: the embedder's `CopyOutputRequest` reads the center pixel after
  aggregation and sends it back to the producer. `--color=FF00C853` returns
  `#FF00C853`. The fallback color is black, so a match cannot be the fallback.

Embedded through a page:

```
$ ... packages/domicile-engine/scripts/spike.sh /build/chromium/src -- --color=FF00C853
brokered frame sink: FrameSinkId(0, 2)
waiting for a page to embed it...
a page embedded us: LocalSurfaceId(1, 1, E8F6...) at 1024x681
BeginFrames are flowing
aggregated: drew #FF00C853, submitted #FF00C853
```

- `1024x681` is the element's layout box, not its `width`/`height`
  attributes. Resize relies on this.
- Control: shrink the element to 16px in a corner so the sample misses it. The
  run reports `NOT aggregated: drew #FF3F51B5`, the page background. CSS moved
  the element and the surface moved with it.

## CSS parity

`guard-css-and-resize.sh` applies each property to an `<app>` and to an
identical ordinary element beside it, then diffs the two halves. 53,200 pixels
per cell. Results are identical on every run.

Differing: pixels over the diff threshold. Interior: differing pixels not on
an edge. Worst Δ: largest channel difference.

Software rasterization (`--disable-gpu`):

| Property | Differing | Interior | Worst Δ |
|---|---|---|---|
| `z-index` | 0 | 0 | 0 |
| `border-radius` | 0 | 0 | 1 |
| `opacity` | 0 | 0 | 2 |
| `filter: blur()` | 0 | 0 | 1 |
| `mix-blend-mode` | 0 | 0 | 1 |
| resize | 0 | 0 | 1 |
| `transform` | 285 | 0 | 84 |
| negative control | 10,800 | 9,976 | 255 |

On the GPU (`GPU=1`), every cell differs by 0 pixels, `transform` included.
The worst Δ is 0–3, under the threshold. The 285 `transform` edge pixels were software
rasterization.

- **`z-index`** is the main reason for the fork. An `<app>` at `z-index: 1` paints
  above an element at `0` and below one at `2`. Both of those come after it in
  document order, so document order alone would not produce this.
- **Resize** is layout-driven. The page changes one CSS rule. The producer sees
  `LocalSurfaceId(1, 1, …) at 120x90` become `LocalSurfaceId(2, 1, …) at
  180x130`. Nothing in the page calls anything.
- **Guards against false passes:**
  - Each cell is also compared to the baseline cell. A property that never took
    effect leaves both halves plain, and the run fails.
  - The last cell's control uses a color the producer never submits, so a diff
    that cannot see differences fails there.
- `spike-css-page.html` and `spike-resize-page.html` use `<app app-id="…">`.
  `scripts/test-parity-page-uses-the-native-tag.sh` keeps them that way. It
  runs in the shell group, because a page back on the canvas path would
  measure the wrong element and still pass.
- The canvas path (`embedExternalSurface()`) gives the same numbers in both
  tables.

## `<app>` compared to an out-of-process iframe

`spike-iframe.sh`, on the GPU, under `transform`, with a cross-site `<iframe>`
in its own renderer:

| Comparison | Differing | Interior | Worst Δ |
|---|---|---|---|
| `<app>` vs `<div>` | 0 | 0 | 0 |
| `<app>` vs OOPIF | 255 | 0 | 52 |
| OOPIF vs `<div>` | 255 | 0 | 52 |

- An `<app>` matches a `<div>` exactly. The OOPIF does not.
- The third row checks the iframe is out of process. If it ever matched a
  `<div>`, all three rows would be comparing against `<div>`s.
- `spike-iframe-page.html` still embeds through the canvas. The two paths agree
  to the pixel, so the result holds for `<app>`.
- [ENGINE-FORK-CHROMIUM-NOTES.md](ENGINE-FORK-CHROMIUM-NOTES.md#surfacelayerbridge-vs-the-oopif-path)
  lists the layer setting differences that do not explain the OOPIF's edge
  pixels.

## Producer latency

The producer changes its color, then polls for the pixel where the page put the
`<app>` until it changes. 60 rounds, against 60 rounds of the same poll with
nothing changed:

| | |
|---|---|
| display frame interval (viz `BeginFrameArgs`) | 16.67 ms |
| poll round trip, nothing changed | median 16.67 ms, 1.0 frames |
| submit to new color drawn | median 16.68 ms, 1.0 frames |
| draws until the new color appears | 1, on 60 of 60 rounds |

The two distributions match. A frame from outside the renderer lands in the
same display frame as the page around it. There is no extra stage.

- Across runs the median moves between 1.0 and 2.0 frames on the same binary,
  but the two columns never differ by more than 0.1 frames. Compare the
  columns, not the absolute numbers.

## Keystroke to pixel

`guard-latency.sh` times a key into a client's seat, the client drawing, and
the pixel reaching the page. It uses a real Wayland client under
`under-wayland.sh`. `latency.rs` is the compositor half.

| Run | Commit to pixel | Frame | Ratio |
|---|---|---|---|
| 1 | 29.18 ms | 16.67 ms | 1.75 |
| 2 | 27.99 ms | 16.67 ms | 1.70 |
| 3 | 28.18 ms | 16.67 ms | 1.69 |
| 4 | 28.24 ms | 16.67 ms | 1.71 |

- The limit is a count of display frames, `MOST_FRAMES=2`. A limit in
  milliseconds would measure whatever else the runner was doing.
- `guard-latency.sh`'s header has the full reasoning.

Two rules keep each round tied to its keystroke. The negative control (a
client that ignores keys) found both:

- **A pixel that changes before the client commits is discarded.** It came from
  an earlier frame. Counted as `round(s) whose pixel moved before the client
  answered`.
- **A commit more than eight display frames after the key is discarded.** The
  worst real `key to commit` over 60 rounds was 44.11 ms (2.6 frames), so the
  cutoff leaves three times that. Counted as `round(s) whose commit came too
  late to be the key's answer`.

### On a tty

All runs above are nested in a headless wlroots compositor, so the frame is
that compositor's. `PLATFORM=drm` runs on the scanout platform:

- The engine gets `--start-fullscreen`. `ScreenManager` gives a window a
  controller only if it exactly matches the CRTC's mode. See
  [A-DESKTOP-ON-A-TTY.md](A-DESKTOP-ON-A-TTY.md#the-window-has-to-be-the-size-of-the-crtc).
- The run refuses `drm` inside a session (no DRM master) and `wayland` outside
  one (no compositor).
- `latency_window_flags` and `latency_platform_refusal` in `lib-latency.sh`
  implement this. `scripts/test-the-latency-run-picks-its-platform.sh` tests
  it.
- Nobody has run it. [ROADMAP.md](/ROADMAP.md) (*Needs a machine with a
  screen*) has the command. It would still not measure presentation.

## A client's window on the page

```
$ nix develop .#full --command \
    packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
    packages/domicile-engine/scripts/guard-client-window.sh /build/chromium/src
the engine is listening on /tmp/domicile-client-window-broker
driving kitty, drawing #3366CC
the engine drew #FF3366CC; the client drew #3366CC
PASS: a Wayland client's own window is on the page, in its own color
```

- Four processes: a headless wlroots host, the engine, `domicile-compositor`
  with `--engine-socket`, and kitty as a GL client of the compositor.
- Exact on two colors. `NEGATIVE=1` runs with no client and must report
  `nothing drew`.
- kitty allocates `ARGB8888`. A wrong format mapping shows as swapped red and
  blue.

## dmabuf import

`spike-dmabuf.sh`, under `under-wayland.sh`:

```
allocated two 992x639 dmabufs as rendering, 1 plane(s), modifier 0x300000000cdb014
imported: buffers 1 and 2
submitted the first
submitted the second, which is what frees the first
released: surface 1 buffer 1 — wl_buffer.release
drew #00000000 from an unfilled renderable dmabuf — sampled, so the texture path works
```

- A release takes two frames. Viz holds the buffer on screen until another
  replaces it. This is why Wayland clients double-buffer.
- NVIDIA's gbm will not allocate a buffer that is both CPU-writable and
  sampleable (`rendering|linear` is refused).
- A linear buffer imports but draws as the fallback. `LINEAR=1` runs this
  case.
- The harness cannot fill a tiled buffer, so it asserts the zeroed content
  `#00000000`, not the fallback `#FF000000`.
- Do not claim `SCANOUT` on the `SharedImage`. A render node with no KMS cannot
  allocate for it, and the image is created but never drawn.
- The submit path was checked first with a `SolidColorDrawQuad` on the same
  sink, so a black frame implicates the texture, not the plumbing.

## Host shortcut inhibitor

Two guards, because the request and the result can disagree.

- **`guard-shortcuts-inhibitor.sh`: the engine asks.** It runs the engine
  nested with `WAYLAND_DEBUG=1` and looks for
  `zwp_keyboard_shortcuts_inhibit_manager_v1#23.inhibit_shortcuts(…)`. The
  control run without the switch must not send it. Setup: the host must
  advertise the inhibit manager (sway does), and the seat needs a keyboard, so
  the guard creates a virtual one.
- **`guard-shortcuts-inhibitor-chord.sh`: the host honors it.** It binds
  `Mod4+y` in sway to append to a log, then presses it through `wtype` with the
  window focused.

  | | Host log | Page (`GUARD keydown key=y`) |
  |---|---|---|
  | with the switch | must not fire | must arrive |
  | without (control) | must fire | must not arrive |

  - Before the engine starts, the chord is pressed once and must fire, which
    shows the host observer works.
  - A plain `u` must reach the page, which shows the page observer works.
  - A chord neither side saw fails. An engine that died fails first.
  - It needs a reachable sway, so it is separate from the request guard.
  - Not covered: hosts other than sway, physical keyboards.
