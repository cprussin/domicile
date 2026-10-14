# Frame-synced surfaces

A commit that moves a client's popup or bubble shows in the same display frame
as the content it moved with. The commit goes to viz under a new
`LocalSurfaceId` the producer allocates, and the page embeds that id in the
same rendering update that applies the move.

## Problem

Each popup (`HostMessage::PopupPlaced`) and each bubble (a subsurface,
`popups.rs`) is its own `<app>`, placed by the page from a control-channel
message.

- The client's commit reaches viz at once. The message reaches the page later,
  on another path ([WINDOW-COMPOSITING.md](WINDOW-COMPOSITING.md#what-each-side-knows)).
- So a parent's new content shows a frame or more before its bubble moves.
  `wl_subsurface` sync mode is not honored across `<app>`s.

## Design

```
 one commit transaction (parent + its bubble)
   ├─ domicile_surface_sync(parent, n); submit ──▶ viz: parent at (p, 1+n)
   ├─ domicile_surface_sync(bubble, m); submit ──▶ viz: bubble at (q, 1+m)
   │                                               (page still shows n-1, m-1)
   └─ PopupPlaced { position, frames: {parent: n, bubble: m} } ──▶ page
                                                                   │
        one render:  <app app-id=parent frame=n>                 ◀─┤
                     <app app-id=bubble frame=m style="left: …"> ◀─┘
```

- **Synced frame:** a number per surface, from 1. Frame `n` is the
  `LocalSurfaceId` the page allocated with child sequence number
  `kInitialChildSequenceNumber + n` (`components/domicile/common/synced_frame.h`).
  Frame 0 is the id the page allocated.
- **Producer:** `domicile_surface_sync(engine, surface, n)` makes that submit
  and every later one go up at frame `n` of the newest box. Viz accepts a
  child-sequence bump as monotonic (`CompositorFrameSinkSupport`,
  `child_initiated_synchronization_event`), as for an OOPIF.
- **Embedder:** `<app frame="n">` embeds frame `n` of its allocated id, with
  the default deadline. Viz holds the page's frame until frame `n` activates,
  so the move and the content show together.
- **Before the page embeds it,** the old frame stays on screen. A
  `SurfaceLayer` range has no start, so viz draws the newest active surface
  not newer than the embedded id (`FindLatestActiveSurfaceInRange`).
- **Unsynced commits** go up at the newest frame, so they add no latency once
  the page shows that frame.

## Key decisions

- **The number rides the control channel, not the embed pipe.** The page
  needs it in the same render as the move, which arrives there too. The
  default deadline covers a message that beats its frame to viz.
- **A commit transaction is the unit.** For a sync subsurface, Smithay calls
  `CompositorHandler::commit` for each surface of the parent's transaction
  (`Transaction::apply`), so one transaction holds the parent's content, the
  bubble's content and the bubble's position. The compositor syncs each
  surface in it that submits, and broadcasts the move after the last submit.
- **The compositor names a frame only after submitting it.** A stuck client
  never holds the shell. A dropped submit (no buffer, refused fence) keeps
  its frame for the next submit, so the page waits at most one deadline.
- **A stuck page holds synced client frames.** Viz acks a frame only when it
  is drawn or replaced, so the client's `wl_surface.frame` waits for the page
  or for the 250 ms deadline ([WINDOW-COMPOSITING.md](WINDOW-COMPOSITING.md#frame-pacing)).
  The page auto-embedding the newest frame would defeat the sync, so it does
  not.
- **Resizes compose.** A resize allocates `(p+1, 1)`. The producer submits
  frame `n` of it, `(p+1, 1+n)`, and the page embeds the same, because both
  apply `n` to the allocated id. The page never calls `UpdateFromChild`.
- **Eviction is not a risk.** Viz garbage-collects only surfaces marked for
  destruction, and the newest surface of a sink is not marked
  (`SurfaceManager::GarbageCollectSurfaces`). An unembedded frame lives until
  a newer one activates.
- **A page that lags a resize by a synced frame** draws the previous parent
  sequence's frame stretched until it catches up. No stall: a newer surface
  in the allocation group resolves the deadline.

## Plan

- [x] `synced_frame.h`: frame `n` of an allocated id, unit tested
- [x] engine library: `domicile_surface_sync`
- [x] `<app frame>`: embed frame `n` with the default deadline
- [ ] compositor: call `domicile_surface_sync` for each surface of a commit
      transaction that moves a bubble or popup, then broadcast the message
- [ ] protocol: `frames` on `PopupPlaced` (Rust and `e2e-harness`)
- [ ] SDK and manganese: keep each app's frame; render `frame` on the window
      and popup `<app>`s in the same render as the move
- [ ] opt-in: sync only for a page that says it renders `frame`
- [ ] guard on `crux`: a parent with a sync bubble scrolls; each captured
      frame shows the bubble at the parent's content
- [ ] update [WINDOW-COMPOSITING.md](WINDOW-COMPOSITING.md#what-each-side-knows)
      and delete this doc

## Open questions

- **Opt-in.** A page that never sets `frame` shows frame 0 forever once the
  compositor syncs. Recommendation: a `Hello` field the SDK sends when the
  shell renders `frame`; the compositor syncs only then.
- **A bubble's own content.** In sync mode the bubble's buffer also applies on
  the parent's commit. Recommendation: sync it in the same transaction, as the
  diagram shows, rather than position only.
