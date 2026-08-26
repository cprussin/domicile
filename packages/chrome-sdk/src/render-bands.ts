// The chrome's half of rendering one band at a time.
//
// A band is one depth of the chrome drawn on its own, so the compositor can put
// a window between two of them. Nothing in a band is flattened together with
// another, which is the whole point: a band clipped out of one raster carries
// whatever the page had already blended into those pixels, and no ordering can
// unmake that.
//
// **The commit is the answer.** There is no message back — the compositor asks
// for a band and takes the page's next Wayland commit as that band, because the
// page cannot label its own frames (the connection belongs to Chromium, not to
// the page). Everything awkward here follows from that one fact:
//
// - **One commit per request, in the frame the request is handled.** A second
//   commit for the same band is a commit the compositor attributes to the
//   *next* band, so anything deferred to a later frame — a `requestAnimationFrame`,
//   a timeout, an await — turns into the very off-by-one this exists to avoid.
//   Worse after the last band: an unasked commit makes the compositor discard
//   every band it holds and start the round trip again, for ever.
// - **A commit has to actually happen.** If handling the request changes no
//   style, Chromium has nothing to invalidate, does not paint, and does not
//   commit; the compositor's question then stands for ever and the desktop's
//   chrome freezes. See `nudge`.
// - **Nothing else may commit while a band is outstanding.** This module causes
//   no repaint of its own, but a CSS animation or a video in the shell still
//   would, and that is the shell's to know. See `BridgeClient.declareBands`.
//
// A shell that never calls this is drawn as one layer over every window, which
// is what every chrome did before bands existed.

import type { BridgeClient } from "./bridge";

/** Show only this band, hiding every other. The shell's own business. */
export type ShowBand = (band: number) => void;

/**
 * What this needs of a bridge.
 *
 * `Pick` rather than a hand-written shape, so the wire types stay the bridge's
 * to define: a field added to `render_band` reaches here rather than being
 * quietly restated as something narrower.
 */
export type BandBridge = Pick<BridgeClient, "declareBands" | "on" | "off">;

/**
 * Declare `depths` and answer every `render_band` by showing that band.
 *
 * `depths` are `z-index` values, in the space `place_portal` reports a window's
 * in — so a window at `z-index: 2` lands between a band at 1 and one at 3.
 *
 * @param show - Called with the band to show, synchronously. It must leave
 *   *only* that band painting, because what the page commits next is the raster
 *   the compositor draws at that depth.
 * @returns A function that stops answering. The registration is a single slot
 *   on the bridge, so a shell that mounts twice — React's strict mode, a hot
 *   reload — displaces its own handler without this.
 */
export const renderBands = (
  bridge: BandBridge,
  depths: readonly number[],
  show: ShowBand,
): (() => void) => {
  const answer = ({ band }: { band: number }): void => {
    show(band);
    // In the same frame, deliberately. The page paints once for both and
    // commits once, and that commit is the answer.
    nudge();
  };
  bridge.on("render_band", answer);
  bridge.declareBands(depths);
  return () => {
    bridge.off("render_band", answer);
  };
};

/** The element whose only job is to make sure a frame happens. */
const NUDGE = "domicile-band-nudge";

/**
 * How many times a band has been shown, so the style below always changes.
 *
 * A value derived from the *band* would repeat — a one-band chrome asked twice
 * gets band 0 both times, and setting a style to the value it already holds is
 * not a change: Chromium invalidates nothing, paints nothing, and commits
 * nothing. That is the frozen chrome this exists to prevent, reached by the
 * very code meant to prevent it.
 */
let shown = 0;

/**
 * Guarantee the page commits something for this band.
 *
 * What is needed is a paint *invalidation*, not a visible difference: Chromium
 * submits a frame because something was invalidated, whether or not the result
 * differs from the last one. So this changes a style property to a value it did
 * not hold, on one fixed pixel in the corner — `opacity`, so it costs no
 * layout, and small enough to be invisible against anything.
 */
const nudge = (): void => {
  shown += 1;
  const held = document.getElementById(NUDGE) ?? mount();
  held.style.opacity = shown % 2 === 0 ? "0.004" : "0.008";
};

/** The nudge element, created once and left in the page. */
const mount = (): HTMLElement => {
  const held = document.createElement("div");
  held.id = NUDGE;
  held.style.position = "fixed";
  held.style.inlineSize = "1px";
  held.style.blockSize = "1px";
  held.style.insetBlockStart = "0";
  held.style.insetInlineStart = "0";
  // Out of the way of everything a shell does with the page: it takes no
  // pointer, and `elementFromPoint` sees through it.
  held.style.pointerEvents = "none";
  document.body.append(held);
  return held;
};
