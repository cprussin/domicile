// Which layer of the chrome a piece of the page belongs to, and how the shell
// shows one at a time.
//
// The compositor draws a window *between* two layers of chrome by asking for
// one layer at a time and compositing the rasters in depth order with the
// windows. What it asks of the shell is a raster per depth: the page painting
// only that depth and nothing else. See `@domicile/chrome-sdk/render-bands`.
//
// That is a whole-page property rather than any component's, which is why the
// elements are marked with an attribute and driven from here rather than
// through React. Two things decide the shape of it:
//
// - **It has to happen in the frame the request is handled.** What the page
//   commits next is the raster, and `setState` schedules — the commit would
//   carry whatever was on screen before React got to it.
// - **`opacity`, not `visibility` or `display`.** The page *stays* in the last
//   band it was asked for; nothing puts it back, because putting it back is a
//   repaint and a repaint is another round trip. A hidden element takes no
//   pointer, so the chrome would be dead to the mouse between cycles, and a
//   `display: none` one has no box, so every window would move. An element at
//   `opacity: 0` lays out as it did, takes the pointer as it did, and paints
//   nothing. What the user looks at is the bands composited, not the page.

// **This shell paints no desktop background, and must not start.** The band
// work is what makes one tempting — `html` is an ancestor of every band, so a
// background there lands in every raster and the topmost band covers the
// windows under it — and moving it onto an element of band 0 is worse rather
// than better: on the composited path that element goes *behind* every window
// and fills in the holes the clients show through. A whole desktop of windows
// hidden behind their own wallpaper, with nothing on screen to say why.
//
// The background is the host's, injected per path: `html, body { background:
// transparent }` where Domicile composites this window, and the page's own
// where it does not. See `electron-chrome-host/src/chrome-window.ts`.
//
// `e2e-window-shows-through.sh` is what catches a background added back: it
// draws a window, reads a pixel of the chrome over it, and requires that pixel
// not to be fully opaque, because nothing the chrome is entitled to paint over
// a window is. This paragraph used to say no such check existed; it does, and
// it works.
//
// It has been proven, the hard way. A background was added to the stage, that
// check went red on exactly this, and the verdict it fired was argued down as
// a false positive instead of believed — the reasoning being that on the copy
// path the page draws the window into a `<canvas>` *above* the background, so
// the window is plainly still visible and a screenshot says so. That much is
// true and it is beside the point: on the composited path there is no canvas,
// the background is a raster of its own, and the topmost band covers the
// window. Which path a desktop is on depends on whether its clients can
// allocate a dmabuf, so a machine with no render node cannot reproduce the
// failure and every check on one passes.
//
// So: the reading is fully opaque over a window means the window is not on
// screen, whatever a screenshot taken on the copy path shows. Retuning that
// verdict to accommodate a background is retuning the one thing that catches
// this.

/** The attribute a band's own elements carry, valued with the band's index. */
export const BAND = "data-band";

/** And the one this puts on the bands that are not being shown. */
export const NOT_SHOWN = "data-band-hidden";

/**
 * Leave only `band` painting.
 *
 * Every element that paints anything carries {@link BAND}. Anything unmarked
 * paints in *every* band, which is only ever right for something that paints
 * nothing: a `<domicile-app>` portal is a hole in the page, and marking one
 * would fade it to `opacity: 0` — which the SDK reports, and which takes the
 * window off the screen.
 */
export const showBand = (band: number): void => {
  for (const layer of document.querySelectorAll(`[${BAND}]`)) {
    if (layer.getAttribute(BAND) === band.toString()) {
      layer.removeAttribute(NOT_SHOWN);
    } else {
      layer.setAttribute(NOT_SHOWN, "");
    }
  }
};

/**
 * The depths this shell draws at, given how many of its windows are floating.
 *
 * Band 0 is everything under every floating window — the backdrop, the rail,
 * and whatever is on the stage. Each float's own chrome is then a band at that
 * float's own depth, so the window in front of it is drawn over it: a float's
 * window carries `z-index: 1 + its place in the stack`, which is where these
 * numbers come from. See `window-styles`.
 *
 * Nothing floating is no bands at all, rather than one. A desktop with nothing
 * to interleave has nothing to gain from the round trip, and one band would
 * cost one per repaint for a picture the compositor already has.
 */
export const bandDepths = (floating: number): readonly number[] =>
  floating === 0 ? [] : Array.from({ length: floating + 1 }, (_, band) => band);

/**
 * Put the whole chrome back.
 *
 * What a shell that stops declaring depths owes the page it left mid-cycle:
 * the bands stay as they were, because nothing puts them back — so a page
 * abandoned showing band 2 is a desktop with everything but band 2 missing.
 */
export const showEveryBand = (): void => {
  for (const layer of document.querySelectorAll(`[${NOT_SHOWN}]`)) {
    layer.removeAttribute(NOT_SHOWN);
  }
};
