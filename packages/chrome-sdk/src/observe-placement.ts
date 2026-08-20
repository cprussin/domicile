// Watching everything that can move a portal.
//
// A `ResizeObserver` — which is what this used to be — sees a box change size
// and nothing else. None of the things a chrome does to a window most often
// changes its size: moving it, animating a transform, a `:hover` filter, a
// class toggle, an ancestor scrolling. Every one of them changes where or how
// the compositor must draw that window, and a portal that followed only size
// would sit still while its element slid across the page. The window and the
// hole it is drawn into would come apart, with no error anywhere to say so.
//
// The browser has no "this element's box moved" event, so the box is read once
// per animation frame instead. That is the rate at which the page can change
// anyway, and it is the same answer every anchored-positioning library reached
// before CSS grew anchors of its own.
//
// One loop for every portal rather than one each: they all want the same
// moment, and a second timer per window would multiply the cost for nothing.
// That cost is not small — a `getBoundingClientRect`, a `getComputedStyle` and
// some twenty computed-property reads per window per frame, and the shell
// keeps every window mounted and merely hidden, so most of them are paying it
// to learn they are still hidden. Worth an early-out for an element with no
// box; recorded in ROADMAP.md rather than guessed at here.
//
// The loop stops itself when the last portal goes, and the browser stops it for
// us while the page is not being painted at all.
//
// What keeps this off the socket is the caller: an element that measures the
// same box it measured last frame sends nothing.

/** Call `onMoved` on every animation frame; returns the function that stops. */
export type ObservePlacement = (onMoved: () => void) => () => void;

const following = new Set<() => void>();
let running = false;

export const defaultObservePlacement: ObservePlacement = (onMoved) => {
  // Absent outside a browsing context, where nothing is laid out and so
  // nothing can move. The same rule the rest of the SDK follows for a missing
  // DOM API: an implementation that does not have this is one whose answer
  // would have been "nothing changed" anyway.
  if (typeof requestAnimationFrame === "undefined") {
    return () => {
      // Nothing was started, so there is nothing to stop.
    };
  } else {
    following.add(onMoved);
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
    return () => {
      following.delete(onMoved);
    };
  }
};

const tick = (): void => {
  // One shared loop means one window could take the others down with it, and
  // that is the one thing the per-element observers this replaced gave for
  // free. A throw is not hypothetical: `new DOMMatrix(…)` throws on a computed
  // value the SDK cannot parse, and it has. So a window that cannot be
  // measured costs that window and no other — not the windows after it in the
  // set this frame, and not every window on every frame after it, which is
  // what a loop that stopped rescheduling itself would cost.
  const failures: unknown[] = [];
  // Iterated directly rather than through a copy. `Set` iteration skips an
  // entry deleted before it is reached, which is what should happen: a portal
  // unfollowed earlier in this very pass has been disconnected, and measuring
  // a detached element would report a window that is not there. Newly added
  // entries *are* visited, which is harmless — a portal that mounts mid-pass
  // has already placed itself from `connectedCallback`, and the second
  // measurement finds nothing changed and sends nothing.
  for (const onMoved of following) {
    try {
      onMoved();
    } catch (failure) {
      failures.push(failure);
    }
  }
  // Asked after the pass rather than before it, so the last portal to go stops
  // the loop on the frame it goes rather than one after.
  running = following.size > 0;
  if (running) {
    requestAnimationFrame(tick);
  }
  // Nothing is swallowed, and nothing is masked. Rethrown once every portal
  // has had its turn and the next frame is booked, so it reaches the browser's
  // own handler with its stack the way an uncaught error always would — and
  // all of them do, because set order is stable: keeping only the first would
  // hide the second window's failure for the life of the page while reporting
  // the first sixty times a second.
  //
  // An array rather than a single slot because `throw undefined` is legal, so
  // one slot could not tell "nobody threw" from "somebody threw `undefined`"
  // without a second flag beside it.
  if (failures.length === 1) {
    throw failures[0];
  } else if (failures.length > 1) {
    throw new AggregateError(failures, "portals that could not be measured");
  }
};
