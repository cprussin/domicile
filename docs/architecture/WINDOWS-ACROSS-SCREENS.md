# Windows across screens

A floating window in `shell-manganese` is dragged from one monitor to another,
and while it crosses it is drawn on both. Ownership follows the window's
center; drawing follows every screen it overlaps. The shell half lands first
and hands the window over at the center; the engine half lets one client
window be embedded by several pages, which is what makes it span.

## Problem

On a tty a desk of N monitors is N pages
([A-DESKTOP-ON-A-TTY.md](A-DESKTOP-ON-A-TTY.md)), and a floating window
cannot leave the one it is on:

| Blocker | Where |
|---|---|
| A `Float` is in its workspace's screen's pixels, and nothing moves it to another workspace | `floatMoved` in `window-management/workspace.ts` |
| A page draws only the workspace on its own screen; a window past the edge is clipped | `Monitor.tsx`, `<Screen>`'s `onThisPage` |
| The drag lives in the `FloatGrab` that was pressed; it unmounts if the window leaves this page's `Stage` | `floating/useFloatDrag.ts` |
| A second page embedding a client window blanks the first: each embed allocates a newer `LocalSurfaceId` and moves the frame sink's single parent | `BrokeredFrameSink::Embed` |
| A `<webview>`'s guest has one embedder; the same window in another page is a new guest, so a reload | `webview-element.ts` |

Nested (one page spans every display) has only the first and third.

## Design

### Ownership: the screen under the center

A `Float`'s `x`/`y` are in the pixels of the screen showing its workspace;
`Monitor` shifts them by `geometry.screen` into its page's
(`onScreen` in `floating/float.ts`). `WindowMoved(id, x, y, on)` is in the
pixels of screen `on`, the one the drag started on. `floatDragged` in
`window-state.ts` converts by the difference of the two
`WindowState.screens[].box` origins, then checks the float's center: on
another screen, the float moves to the workspace that screen shows
(`floatLifted`, `floatLanded` in `workspace.ts`) and `focused` goes with it.
That is sway's `floating_fix_coordinates`. A center in a gap between screens
stays where it is.

### The drag stays with the page that was pressed

The pressing page keeps getting moves after the pointer crosses to another
CRTC. A button press gives the views widget capture
(`Widget::OnMouseEvent` → `DrmWindowHost::SetCapture` →
`DrmWindowHostManager::GrabEvents`), and patch 0050 moves the cursor without
dropping the grab. So `clientX` keeps going past `innerWidth`, in this page's
coordinates. The host describes the desk in the same coordinates, so the
arithmetic above needs no conversion.

`useFloatDrag` attaches its `window` listeners in the press handler and
removes them on release, so the drag survives the pressed element unmounting
when the window leaves this page's `Stage`.

### Drawing: every screen the window overlaps

`placementsOf(state, geometry)` adds the **overhangs**: floats from other
screens' workspaces whose boxes cross this screen, shifted by the box delta and
stacked above this screen's own floats. The owning screen draws the window as
usual. The others draw an `<app mirror>`:

| | Owning page | Mirroring page |
|---|---|---|
| Embeds the surface | yes | yes |
| Sends `configure_at` (size, scale) | yes | no |
| Pointer over it | forwarded (`pointer-input.ts`) | forwarded, same path |
| Pixels | native | resampled if its scale differs |

Engine, in `BrokeredFrameSink`:

- `parent_frame_sink_id_` becomes a set. `Embed` adds a parent; a page that
  unembeds removes its own parent and nobody else's.
- The broker allocates the window's `LocalSurfaceId`, not each page. Every
  page embeds the same `SurfaceId`, so none of them makes another's stale.
- An embed marked `mirror` registers a parent and nothing else.

### Browser windows stop at the edge

A `<webview>` cannot be mirrored or moved to another page without a reload.
Until a guest can be adopted by another page, a floating browser window's drag
is clamped to its screen.

## Key decisions

- **Center over pointer** for ownership. It matches sway, and a window
  dragged by its far edge does not change owner the moment the hand crosses.
- **Mirror in the engine, not a snapshot in the page.** Both halves stay live,
  input included, and `fullscreen global` gets the same fix.
- **Owner's scale for the buffer.** Configuring at the highest overlapping
  scale would resize the client every time the window crosses a boundary.

## Plan

Phase 1, shell only. The window jumps at the center and is clipped before
then.

- [x] `floatDragged` in the `WindowMoved` arm, with the focus following it
- [x] The drag outlives its element
- [x] Clamp a browser window's drag to its screen
- [ ] Hardware check: moves keep arriving at the pressing page past its edge (ROADMAP, *Needs a machine with a screen*)

Phase 2, engine plus shell. The window spans screens.

- [ ] `BrokeredFrameSink`: a set of parents, and a `LocalSurfaceId` the broker owns
- [ ] `<app mirror>`: embed without configuring (chrome-sdk `app-element.ts`)
- [ ] Overhangs in `placementsOf`
- [ ] `fullscreen global` drawn on every screen through the same mirrors

Phase 3.

- [ ] Another page's `<webview>` adopts a guest without reloading it, and the clamp comes off

## Open questions

- **Does capture really cross CRTCs?** Only hardware can confirm it. If it
  doesn't, the drag has to pass to the page under the pointer: put the grab
  offset in `WindowState` next to `draggingId`, and let the page that sees
  `pointermove` with a button held continue it.
- **Tiled windows.** A tiled drag onto another screen's window could drop
  into that tiling (`WindowDroppedOn` across screens). Recommend: a separate
  item, alongside `move <direction>` crossing screens the way `focus
  <direction>` already does.
