# Stacking without a fork: closed routes

Routes tried and ruled out for stacking a window among page elements without
forking the engine. Don't rerun them. The resulting design is
[ENGINE-FORK.md](ENGINE-FORK.md).

The question: can a client's window be stacked among chrome elements by CSS
`z-index` without forking the engine? No. The premise was that Chromium already
emits its layer tree as Wayland surfaces and only needs a compositor to accept
it. That is false for the shipping engine.

| Route | Verdict |
|---|---|
| Import a client dmabuf into the page as a texture | **No API.** CEF's dmabuf support is output-only: `OnAcceleratedPaint` / `cef_accelerated_paint_info_t` exports a shared texture. Nothing imports one. |
| `<video>` / Media Source as the import | Chromium's zero-copy video path needs frames created in its own GPU process via `GpuMemoryBuffer`. |
| WebGPU `importExternalTexture()` | Takes an `HTMLVideoElement`, so same as the row above. |
| `OnAcceleratedPaint` as the layer tree | Emits one composited texture: the page as a flat raster, however many layers it has. |
| Delegated compositing (`WaylandOverlayDelegation`) | **Measured, no.** With every protocol the engine asks for implemented, a 600x400 page arrives as one 632x442 buffer with 1 or 8 composited layers. `place_above`/`place_below` are never called. Only the root is delegated. |
| Color management blocking delegation of child surfaces | **Ruled out.** With `WaylandWpColorManagerV1` disabled, the counts are unchanged. |
| `surface-augmenter` as what enables delegation | **Ruled out.** Advertised, but the engine never binds it. |
| Lift `components/exo` out of the tree | **No.** It depends on `//ash`, `//ui/aura`, `//ui/views` and `//ui/wm` (in `surface.cc` and `surface_tree_host.cc`), and it is one `static_library("exo")` target. `buffer.cc` is reusable: its only ChromeOS dependency is two calls to `aura::Env::GetInstance()->context_factory()`. |
