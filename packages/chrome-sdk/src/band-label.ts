// The colour a chrome paints to say which band the frame it is committing is.
//
// The compositor asks for one band at a time and has to know which band the
// commit that follows is. The page cannot tell it: the Wayland connection
// belongs to Chromium rather than to the page, so the page has no handle on
// the stream its commit rides on — and a label sent back over the chrome
// socket crosses a different transport, which nothing orders against the
// commit it describes.
//
// What the page *can* label is what the frame looks like. So while it answers,
// it paints one pixel of a known colour into the frame's top-left corner, with
// the band written into the green channel. The label rides in the picture, so
// nothing can reorder it against the picture, and a repaint the page made for
// its own reasons carries the wrong band or none.
//
// The other half of `domicile-protocol`'s `band_label`, and pinned to it by
// `wire/band-labels.jsonl`.

/** The channels that say a pixel is a label at all. */
const RED = 208;
const BLUE = 13;

/** How far apart two bands are in the channel that carries them. */
const STEP = 16;

/** Half a step, so a band sits in the middle of its own range. */
const HALF = STEP / 2;

/**
 * The most bands a chrome can declare, which is what the green channel holds.
 *
 * Sixteen depths is a shell with sixteen layers of chrome interleaved with its
 * windows. A chrome that wants more has outgrown one pixel, and is told so
 * rather than having its bands silently wrap onto each other.
 */
export const MOST_BANDS = 256 / STEP;

/**
 * The CSS colour that says a frame is `band`.
 *
 * Throws above {@link MOST_BANDS}: a band that does not fit is one the chrome
 * cannot label, and a wrapped label is a layer of the desktop drawn at another
 * layer's depth — silently, and looking exactly like a stacking bug.
 */
export const bandLabelColour = (band: number): string => {
  if (!Number.isInteger(band) || band < 0 || band >= MOST_BANDS) {
    throw new RangeError(
      `bandLabelColour: band ${String(band)} does not fit a label; at most ${String(MOST_BANDS)} bands can be told apart in one pixel`,
    );
  } else {
    return `rgb(${String(RED)}, ${String(STEP * band + HALF)}, ${String(BLUE)})`;
  }
};
