# One page for the desk

On a tty, the shell is one page that spans every monitor.

- The page's viewport is the desk's bounding box, in logical pixels.
- `navigator.domicile.displays` gives each monitor's rectangle in that box.
- The engine shows the page on every monitor at that monitor's scale and
  refresh rate.
- The shell sees one layout and one frame. It never sees rotation, density or
  a second page.

## Why one page

- On a tty, Chromium binds a window to a CRTC only if the window matches the
  CRTC's rectangle (`ScreenManager::FindWindowAt`). So the engine needs one
  window per monitor.
- A page per window would force every shell to sync N copies of its state.
  A window could not span two monitors, a drag could not cross pages, and
  nothing could animate across a seam.
- So the per-CRTC windows only present. The shell is one page, the same as when
  nested (`Screens::described`).

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

Gaps between monitors are part of the box but never shown. The pointer never
enters a gap, because pointer crossing follows `desk`.

### Browser: one page, N presenters

- `ShellWindows` (`domicile_shell_windows.cc`) keeps one window per CRTC.
- The **host** is the only window that loads the shell. It sits on the fastest
  display (see [Key decisions](#key-decisions)).
- The host's `WebContents` view is sized to the desk box and offset by the
  host's `desk` origin. The window clips it to the host's own slice.
- Every other window is a `DeskPresenter`: a widget with no `WebContents`.
  - Its root `ui::Layer` holds a mirror of the page's surface layer at the
    same offset (`ui::Layer::Mirror`). The page's frame sink is not a child of
    the presenter's compositor (see [Frames](#frames)).
  - `SurfaceAggregator::EmitSurfaceContent` scales a child frame by
    `parent_dsf / frame_dsf`. So a presenter at 1.2 draws the page's frame at
    1.2/S.
  - The window handles rotation.
- The page's `ScreenInfos` list every display. `current()` is the desk box at
  S (`WidgetBase::UpdateSurfaceAndScreenInfo`).

### Input

- `DrmWindowHost` sends every pointer, scroll and key event to the host window
  at its `desk` position (`OzonePlatform::SetDomicileDeskHost`,
  `PointerInWindow`). One window gets all input, so Chromium's own implicit
  grab applies.
- A position on another monitor lies outside the host window's bounds. aura
  only hit-tests inside a window's bounds, so the host's root sends such events
  to the page (`aura::TargetDeskPage`). Capture and the pressed button's window
  still take priority.
- A warp is requested in host pixels. It lands on the monitor that holds that
  desk position (`DrmCursor::MoveCursorTo` via `PointerCrossingFor`). The
  cursor is then drawn with that monitor's rotation and density (`WarpLandsOn`).
- Each CRTC keeps its own cursor (`DrmCursor`). The host sets the cursor shape
  on every monitor.

### Raster: one tiling per display scale

- Each layer keeps a tiling at each lower monitor scale it appears on, plus
  the usual high-res tiling at S. Each monitor gets tiles rastered 1:1 for its
  pixels (patches 0072, 0079).
- Layers under filters, masks or opacity groups, rotated layers and directly
  composited images fall back to S. Viz resamples them.
- Cost: more raster work, activation latency and tile memory per
  lower-density monitor.

Details: [DISPLAY-TILINGS.md](DISPLAY-TILINGS.md).

### Frames

- The page's frame sink has one parent, the host's compositor
  (`DelegatedFrameHost`), so it uses the host display's `BeginFrameSource`.
- A presenter's compositor is never a second parent. viz gives a child its
  first parent's source, and after a detach reattaches from sources ordered by
  pointer (`FrameSinkManagerImpl::UnregisterFrameSinkHierarchy`). A second
  parent could leave the page on a slower monitor's clock.
- A presenter needs no hierarchy to draw the page: its frames reference the
  page's surface
  ([measured](ENGINE-FORK-MEASUREMENTS.md#getting-a-surface-on-screen)).
  `scripts/test-the-desk-page-ticks-at-the-host.sh` checks no
  fork code calls `AddChildFrameSink`.
- A slower display draws the latest surface at its own vsync. A slide across a
  seam is one animation on one clock, sampled by two vsyncs.

### Client windows

An `<app>` is one element wherever it is. The client draws at the scale of
the display holding most of it, as in sway. Other monitors resample its buffer.

- The shell reports each window's box with `DomicileClient.setAppBounds`
  (`set_app_bounds` on the wire). Manganese's `AppWindow` sends it whenever the
  box changes.
- The compositor enters the window on every display the box overlaps and sends
  `wp_fractional_scale_v1.preferred_scale` for the one with the largest overlap
  (`Screens::scale_for`). A client without that protocol gets the rounded-up
  `wl_output.scale` of the displays it entered.
- A window the shell has not reported, or one in a gap, is on every display at
  the densest scale.
- Popups are on every display at the densest scale. They do not follow their
  parent window yet.

### Floats across screens (manganese)

- A `Float`'s `x`/`y` are in the pixels of the screen showing its workspace. A
  drag (`WindowMoved`) is in page pixels. `floatDragged` converts using the
  home screen's box.
- When the float's **center** lands on another screen, the float and keyboard
  focus move to the workspace that screen shows (as sway's
  `floating_fix_coordinates`). A center in a gap stays put.
- Until then, the float draws once at its page position, across both screens.
  Windows are `position: fixed` in page pixels and nothing clips a `<Screen>`.
- One `Stage`, after every monitor's bar, draws every window once for the
  desk, keyed by window id. A float that changes screens keeps its element, so
  a browser window's `<webview>` does not reload.
- A workspace switch slides only its own screen, by that screen's width.

## Key decisions

- **One frame with per-region tilings** over one commit to N
  `LayerTreeHostImpl`s or N frames per draw.
  - N impls split scroll, animations and input across copies.
  - N frames means N-way scheduling and the same tiling work.
  - One frame keeps viz and the browser close to upstream. The cost stays in
    the tiling set.
- **S is the largest scale.** Layout snapped at S puts edges on fractional
  pixels on a lower-density display. Hairlines there get antialiased; text and
  images do not. Snapping at a smaller scale would soften the denser display,
  which loses more.
- **The host is the fastest display.** It drives BeginFrames. A 144 Hz panel
  sampling a 60 Hz page would stutter.
- **A float's center decides its screen,** not the pointer. This matches sway,
  and a window dragged by its far edge doesn't switch screens the moment the
  pointer crosses.
- **The shell reports window boxes** over the engine finding the display under
  each `<app>`. The shell already knows its layout, a box report only feeds the
  scale, and the overlap rule stays in the compositor where it is tested.
- **Presenters per CRTC** over one window spanning every CRTC. Besides
  `FindWindowAt` (see [Why one page](#why-one-page)), per-CRTC page flips and
  rotation assume a window per CRTC and stay upstream.

## Plan

Done:

- [x] Phase 1, one page at S: host and `DeskPresenter`s, desk-sized host view,
  page `ScreenInfos` from the profile, input and warps through the host,
  hardware check on `home-office-right-two`
- [x] Phase 2, native density: display regions, per-scale tilings, raster
  queue and cleanup, per-region `AppendQuads`, fallback under render surfaces,
  activation waits on display tilings (0079)
- [x] Phase 3: floats drawn once at desk level; browser windows cross screens
  without reloading
- [x] `<app>` scale from the display holding most of it

Left:

- [ ] Hardware check: text on the lower-density monitor is crisp
- [ ] Hardware check: with a slower monitor lit, the shell animates at the
  host's refresh rate, including after a resume and a hotplug

## Open questions

- **Popups** (`<select>`, context menus, extension popups). Each is its own
  widget, kept inside its window (patch 0051). Recommend: open on the
  presenter under the anchor, kept inside that CRTC.
- **Filter quality on lower-density displays.** If a blurred bar or shadow
  looks soft there, the next step is per-display render passes (N frames per
  draw). Recommend: measure after the phase 2 hardware check first.
- **Testing multiple displays.** Headless has one screen, and no guard runs
  two CRTCs. Recommend: cc and `ShellWindows` gtests cover the logic; the
  hardware check covers the rest.
