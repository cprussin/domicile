# One page for the desk

A shell is one page whose viewport is the desk's bounding box in logical
pixels, and `navigator.domicile.displays` says where each monitor sits in it.
The engine shows that page on every monitor at the monitor's own density and
refresh rate: one layout, one frame, and tiles rastered per monitor at that
monitor's scale. A shell never sees rotation, density or a second page.

## Problem

On a tty the engine opens one browser window per CRTC and loads the shell in
each ([A-DESKTOP-ON-A-TTY.md](A-DESKTOP-ON-A-TTY.md#turning-a-monitor-is-the-engines-job)).
Every shell pays for it:

| Cost | Where it shows today |
|---|---|
| N copies of the shell's state, kept in step | `desk-channel.ts`, `leadsTheDesk` in manganese |
| A window can't be on two monitors | `withOverhangs`, `<app mirror>`, `ExternalSurfaceProvider.Mirror` |
| A drag can't leave its page | `pressed.on`, patch 0064's pointer holder |
| Nothing animates across a seam | two documents, two clocks |
| A `<webview>` can't cross | a guest has one embedder, so it reloads |

Nested and headless already run one page over the whole desk
(`Screens::described`). This makes the tty path do the same.

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

| | Today on a tty | Now |
|---|---|---|
| `innerWidth`×`innerHeight` | one monitor's logical box | the desk's bounding box |
| `domicile.displays[i].{x,y,width,height}` | re-origined per page | rects in that box, in `desk` coordinates from the profile |
| `fillsTheWindow` | true on one display | removed |
| `devicePixelRatio` | the monitor's scale | `S`, the largest scale on the desk |
| pages | N | 1 |

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

- `DrmWindowHost` sends every pointer event to the host window, at its `desk`
  position (`PointerCrossingFor`'s mapping, turned the other way). Keys go to
  the host.
- The cursor stays per CRTC (`DrmCursor`).
- Patch 0064's holder goes: one window gets everything, so X's implicit grab is
  Chromium's own again.

### Raster: one tiling per display scale

cc keeps one HIGH_RES tiling per layer. This makes it one per distinct display
scale, each prioritized over only its own display's rect:

- `LayerTreeImpl` gets the display rects and scales
  (`SetDisplayRects(std::vector<DisplayRect>)`), next to
  `ViewportRectForTilePriority`.
- `PictureLayerImpl::RecalculateRasterScales` gives each scale present its
  ideal: `s_i/S` times today's ideal.
- `PictureLayerTiling::ComputeTilePriorityRects` takes the tiling's display
  rect, so a gap or another monitor's region is never rastered at that scale.
- `TilingSetRasterQueueAll`, eviction and `CleanUpTilingsOnActiveLayer` treat
  every display-scale tiling as HIGH_RES.
- `TileBasedLayerImpl::AppendQuads` runs the coverage iterator once per display
  rect, with that display's scale as the ideal key.

A tile rastered at `s_i` lands 1:1 on display `i`'s pixels after the
aggregator's `s_i/S`.

**Falls back to S:** layers under a non-root render surface (filters, blur,
masks, opacity groups). viz renders those passes at the frame's scale, so they
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
- **Presenters instead of one window over every CRTC.** `FindWindowAt`, per-CRTC
  page flips and rotation all assume a window per CRTC, and stay upstream.

## Plan

Phase 1: one page, raster at S. Behind `--domicile-one-page` until phase 2,
because a lower-density display is downsampled until then.

- [x] `ShellWindows`: one host, `DeskPresenters` for the rest
- [x] The host's view sized to the desk box and offset; page `ScreenInfos` from the profile
- [x] `DeskPresenters` show the page's surface; host chosen by refresh rate
- [x] Pointer, scroll and keys to the host at `desk` positions (patch 0065)
- [x] No `set_screen` with `--domicile-one-page`, so the compositor describes the whole desk (no compositor change)
- [ ] Hardware check on `home-office-right-two`: `DOMICILE_ENGINE_ARGS=--domicile-one-page`
- [ ] Pointer warp onto another display (clamped to the host's today)

Phase 2: native density.

- [ ] `LayerTreeImpl::SetDisplayRects`, from the host's `ScreenInfos`
- [ ] A HIGH_RES tiling per display scale, prioritized over its display's rect
- [ ] Raster queue, eviction and cleanup keep every display scale
- [ ] `AppendQuads` per display rect
- [ ] Fall back to S under non-root render surfaces
- [ ] `<app>` scale from the display under its center
- [ ] `--domicile-one-page` on by default

Phase 3: take the N-page model out.

- [ ] manganese: `desk-channel.ts`, `leadsTheDesk`, `withOverhangs`, `pressed.on`, `alone`/`coveredHere`
- [ ] `<Screen>`'s `onThisPage`, `fillsTheWindow`, `scanout`
- [ ] Engine: `<app mirror>`, `ExternalSurfaceProvider.Mirror`, patch 0064's holder, `ScreenOf`
- [ ] Compositor: `set_screen`, `as_seen_from`, `Chrome.screen`
- [ ] WRITING-A-SHELL, A-DESKTOP-ON-A-TTY, WINDOWS-ACROSS-SCREENS rewritten to one page

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
