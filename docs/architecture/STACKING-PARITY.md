# Routes that are closed

Context, not a design: it exists so that nobody re-runs an experiment that has
already been run. Each row is a measurement or a source reading rather than an
opinion, and the design that came out of them is
`docs/architecture/ENGINE-FORK.md`.

The question all of them were asked in service of: **can a client's window be
interleaved with the chrome by CSS `z-index`, without forking the engine?**
The answer is no, and this is why.

| Route | Verdict |
|---|---|
| Get a client dmabuf **into** the page as a texture | **No API.** CEF's dmabuf support runs page-out only — `OnAcceleratedPaint` / `cef_accelerated_paint_info_t` carries planes of a shared texture *out*; nothing takes one in |
| `<video>` / Media Source as the import | Chromium's zero-copy video path wants frames made *inside its own GPU process* via `GpuMemoryBuffer` |
| WebGPU `importExternalTexture()` | Takes an `HTMLVideoElement`, so it reduces to the row above |
| `OnAcceleratedPaint` as the layer tree | Emits **one** composited texture — the page as a flat raster, however many layers it has |
| Delegated compositing (`WaylandOverlayDelegation`) | **Measured, negative.** With every protocol the engine asks for implemented, a 600x400 page arrives as a single 632x442 buffer whether it has 1 or 8 composited layers, and `place_above`/`place_below` are never called. A delegated *root*, not a delegated tree |
| Colour management as the thing blocking promotion | **Exonerated.** With the engine's own `WaylandWpColorManagerV1` off, so `wp_color_management_surface_v1` is out of the question, the counts are unchanged |
| `surface-augmenter` as the exo-shaped-compositor gate | **Declined.** Advertised, and the engine never binds it — a client binds what it wants at registry enumeration, before it renders. It is not looking for an augmenter |
| Lift `components/exo` out of the tree | `assert(is_chromeos)` in its `BUILD.gn` is only the parse-time guard; the real gate is its dependency on `//ash`, `//ui/aura`, `//ui/views` and `//ui/wm`, reaching into `surface.cc` and `surface_tree_host.cc`. One `static_library("exo")` target, no core to split out. Worth taking: `buffer.cc`, whose only ChromeOS dependency is two calls to `aura::Env::GetInstance()->context_factory()` |

The premise that made all of this worth trying — that Chromium already emits its
layer tree as Wayland surfaces and only needs a compositor to accept it — is
**false for the engine as it ships**. That is what decided the fork.

## Reading Chromium source from this container

`chromium.googlesource.com` and `source.chromium.org` are blocked by the egress
proxy (403 on CONNECT). The GitHub mirror is served, and a blobless sparse clone
is cheap — 154 MB for the directories that matter:

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/chromium/chromium /home/user/chromium/chromium
git -C /home/user/chromium/chromium sparse-checkout set \
  components/exo cc/layers cc/trees components/viz services/viz \
  content/browser/renderer_host ui/ozone/platform/wayland \
  third_party/blink/renderer/core/frame \
  third_party/blink/renderer/platform/graphics
```

A full `--depth 1` clone would not fit comfortably; `--filter=blob:none
--sparse` is what makes this affordable.

## One trap worth keeping

**Advertising a Wayland global is a promise to honour what clients say through
it.** `wp_viewporter` advertised while the commit path ignored the destination
made every surface twice its logical size at any scale above 1x — the desktop
drawn at double, every portal and pointer coordinate out by the same factor. At
1x the two forms coincide, which is why nothing headless caught it.
