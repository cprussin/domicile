# One page for the desk

A shell is one page whose viewport is the desk's bounding box in logical
pixels, and `navigator.domicile.displays` says where each monitor sits in it.
The engine shows that page on every monitor at the monitor's own density and
refresh rate: one layout, one frame, and tiles rastered per monitor at that
monitor's scale. A shell never sees rotation, density or a second page.

## Why one page

On a tty a window is bound to a CRTC only if it is exactly that CRTC's
rectangle (`ScreenManager::FindWindowAt`), so the engine needs a window per
monitor. A page per window cost every shell: N copies of its state kept in
step, a window that could not be on two monitors, a drag that could not leave
its page, and nothing animating across a seam. So the windows only present;
the shell is one page, as it already was nested (`Screens::described`).

## Design

```
             one shell page (layout at S = max scale, viewport = desk box)
                              │ one CompositorFrame
                              │ tiles per region at that region's scale
          ┌───────────────────┼───────────────────┐
   presenter drm-1     presenter drm-2     presenter drm-3      one per CRTC
   s=1.5, 60 Hz        s=1.2, 144 Hz ★     s=1.2, rotate-270    (★ drives BeginFrames)
```

### The shell's contract

| | |
|---|---|
| `innerWidth`×`innerHeight` | the desk's bounding box |
| `domicile.displays[i].{x,y,width,height}` | rects in that box, from the profile's `desk` rectangles |
| `devicePixelRatio` | `S`, the largest scale on the desk |
| pages | 1 |

A gap between monitors is part of the box and never shown; the pointer never
enters one (the crossing already follows `desk`).

### Browser: one page, N presenters

- `ShellWindows` (`domicile_shell_windows.cc`) keeps one window per CRTC, since
  `ScreenManager::FindWindowAt` needs a window the size of its CRTC. Only one
  loads the shell: the **host**, the window on the fastest display.
- The host's `WebContents` view is sized to the desk box and offset by the
  host's `desk` origin, so the host shows its own slice by clipping.
- Every other window is a `DeskPresenter`: a widget with no `WebContents` whose
  root `ui::Layer` shows the page's `SurfaceId` (`SetShowSurface`, as
  `DelegatedFrameHost` does) at the same offset, plus `AddChildFrameSink`.
  `SurfaceAggregator::EmitSurfaceContent` already scales a child frame by
  `parent_dsf / frame_dsf`, so a presenter at 1.2 draws the page's S frame at
  1.2/S. Rotation is the window's, as today.
- The page's `ScreenInfos` carry every display; `current()` is the desk box at
  S (`WidgetBase::UpdateSurfaceAndScreenInfo`).

### Input

- `DrmWindowHost` sends every pointer, scroll and key event to the host window
  (`OzonePlatform::SetDomicileDeskHost`), at its `desk` position
  (`PointerInWindow`). One window gets everything, so X's implicit grab is
  Chromium's own.
- A warp is asked for in the host's pixels and lands on the monitor holding
  that place on the desk (`DrmCursor::MoveCursorTo` through
  `PointerCrossingFor`).
- The cursor stays per CRTC (`DrmCursor`); the host sets its shape on every
  monitor.

### Raster: one tiling per display scale

cc keeps one HIGH_RES tiling per layer, at S. A layer a less dense monitor
shows also keeps a tiling at that monitor's scale (patch 0069,
`cc/domicile/display_regions.h`):

- The browser lists every lit monitor among the page's screens
  (`DeskScreenInfos`), labeled `cc::kDomicileDisplayLabel`, placed where the
  page is on the engine's screen (`DomicileDeskScreenInfosFor`).
- `WidgetBase` turns those into regions of its own viewport, in device pixels,
  each with the ratio `s_i/S` (`DomicileDisplayRegionsOf`), and hands them to
  `LayerTreeHost::SetDomicileDisplayRegions`. A `<webview>` finds its regions
  by its own screen rect, so it is native too.
- On the active tree, `PictureLayerImpl::UpdateDomicileDisplayTilings` keeps a
  tiling at the high-res scale times each ratio the layer meets. Its priority
  rects are clipped to that monitor's region, so a gap or another monitor is
  never rastered at that scale. It is NON_IDEAL but still makes tiles, and
  `CleanUpTilingsOnActiveLayer` skips it while the monitor shows the layer.
- `TilingSetRasterQueueAll` rasters up to three such tilings, each after the
  high-res tiling in every bin.
- `TileBasedLayerImpl::AppendQuads` covers each region from that tiling
  (`DomicileCoverage`), falling back to high res where a tile is not ready.

A tile rastered at `s_i` lands 1:1 on display `i`'s pixels after viz's
`s_i/S`.

The high-res tiling still covers the whole layer: the pending tree has only it,
and it is what activation waits on and what a region falls back to. So a
lower-density monitor costs extra raster, not less.

**Falls back to S:** layers under a non-root render surface (filters, blur,
masks, opacity groups), layers turned or with an animating transform, and
directly composited images. viz renders those at the frame's scale, so they
are resampled on a lower-density display.

### Frames

- The page's frame sink hangs off the host, so it takes the fastest display's
  `BeginFrameSource`. Registration makes that explicit, not first-come
  (`FrameSinkManagerImpl::RecursivelyAttachBeginFrameSource`).
- A slower display draws the latest surface at its own vsync. A slide across a
  seam is one animation on one clock, sampled by two vsyncs.

### Client windows

An `<app>` is one element wherever it is. `OnSurfaceEmbedded`'s scale (the
buffer scale the client is configured at) is that of the display under the
`<app>`'s center; the other monitor resamples the client's buffer, as every
compositor does.

### Floats across screens (manganese)

- A `Float`'s `x`/`y` are in the pixels of the screen showing its workspace; a
  drag (`WindowMoved`) is in page pixels. `floatDragged` converts by the home
  screen's box, and when the float's **center** lands on another screen it
  moves to the workspace that screen shows, with the keyboard (sway's
  `floating_fix_coordinates`). A center in a gap stays put.
- Until then it is drawn once, at its page position, over both screens: windows
  are `position: fixed` in page pixels, and nothing clips a `<Screen>`.
- The drag's listeners are on `window`, so it survives its element moving to
  the other monitor's `Stage`.
- A browser window's center is kept on its screen: each `Stage` draws its own
  `<webview>`, and another screen's is a new guest, so a reload.

## Key decisions

- **One frame with per-region tilings, over one commit to N `LayerTreeHostImpl`s
  or N frames per draw.** N impls split scroll, animations and input across
  copies. N frames means N-way scheduling and the same tiling work anyway. One
  frame keeps viz and the browser nearly upstream, and the cost lands in one
  place: the tiling set.
- **S is the largest scale.** Layout snapped at S puts an edge on a fractional
  pixel on a lower-density display: a hairline there is antialiased, text and
  images are not. Snapping at the smaller scale would soften the denser
  display, which has more to lose.
- **The host is the fastest display.** It drives BeginFrames, and a 144 Hz
  panel sampling a 60 Hz page would stutter.
- **Center over pointer** for which screen owns a float. It matches sway, and
  a window dragged by its far edge does not change owner the moment the hand
  crosses.
- **Presenters instead of one window over every CRTC.** `FindWindowAt`, per-CRTC
  page flips and rotation all assume a window per CRTC, and stay upstream.

## Plan

Phase 1: one page, raster at S. Done, and the only model.

- [x] `ShellWindows`: one host, `DeskPresenters` for the rest
- [x] The host's view sized to the desk box and offset; page `ScreenInfos` from the profile
- [x] Pointer, scroll, keys and warps through the host at `desk` positions
- [x] The N-page model removed: `set_screen`, `fills_the_window`, `<app mirror>`, the pointer holder, manganese's desk channel and overhangs
- [x] Hardware check on `home-office-right-two`: geometry, input, floats across screens

Phase 2: native density.

- [x] Every lit monitor in the page's `ScreenInfos`; `WidgetBase` makes regions
- [x] `LayerTreeHost`/`LayerTreeImpl::SetDomicileDisplayRegions`
- [x] A tiling per lower display scale, prioritized over its region
- [x] Raster queue and cleanup keep it
- [x] `AppendQuads` per region
- [x] Fall back to S under non-root render surfaces
- [ ] Hardware check: text on the lower-density monitor is crisp
- [ ] `<app>` scale from the display under its center

Phase 3: floats drawn once at desk level, so a browser window can cross
screens without its `<webview>` reloading.

## Open questions

- **Popups** (`<select>`, context menus, extension popups). They are their own
  widgets, kept inside their window (patch 0051). Recommend: open on the
  presenter under their anchor, kept inside that CRTC.
- **Filter quality on the lower-density display.** If a blurred bar or shadow
  there looks soft, per-display render passes (N frames per draw) are the next
  step. Recommend: measure after phase 2 before building it.
- **Testing more than one display.** Headless has one screen, and no guard runs
  two CRTCs. Recommend: cc and `ShellWindows` gtests carry the logic, and the
  hardware check carries the rest.
