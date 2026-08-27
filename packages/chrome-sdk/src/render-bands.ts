// The chrome's half of rendering one band at a time.
//
// A band is one depth of the chrome drawn on its own, so the compositor can put
// a window between two of them. Nothing in a band is flattened together with
// another, which is the whole point: a band clipped out of one raster carries
// whatever the page had already blended into those pixels, and no ordering can
// unmake that.
//
// **The commit is the answer, and it says so in its own pixels.** There is no
// message back — the compositor asks for a band and reads which band the next
// commit is off the frame itself, because the page has no handle on the stream
// its commit rides on (the connection belongs to Chromium, not to the page)
// and a label sent back over the chrome socket would not be ordered against
// the commit it describes. So this paints the band into one pixel of the
// picture; see `band-label`. Two things still follow from the commit being the
// answer:
//
// - **One commit per request, in the frame the request is handled.** Anything
//   deferred to a later frame — a `requestAnimationFrame`, a timeout, an await
//   — paints the label for a band the page is no longer being asked for.
// - **A commit has to actually happen.** If handling the request changes no
//   style, Chromium has nothing to invalidate, does not paint, and does not
//   commit; the compositor's question then stands for ever and the desktop's
//   chrome freezes. That is why the label element also changes shape — see
//   `label`.
//
// What no longer follows is the third thing. A repaint the shell makes for its
// own reasons — a clock, a caret, a video — carries the label of whatever band
// was painted last, which is not the band being asked for; the compositor takes
// it for what it is, drops the bands it holds as pictures of a page that has
// moved on, and asks again. Before the label it was filed as the answer.
//
// A shell that never calls this is drawn as one layer over every window, which
// is what every chrome did before bands existed.

import { bandLabelColour } from "./band-label";
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
    // commits once, and that commit is the answer — carrying, in its top-left
    // pixel, the band it is the answer to.
    label(band);
  };
  bridge.on("render_band", answer);
  bridge.declareBands(depths);
  return () => {
    bridge.off("render_band", answer);
    // The label goes with it. Nothing reads it once nothing is asking, but it
    // is a coloured pixel in the corner of the desktop, and leaving one behind
    // is not this module's to do.
    document.getElementById(LABEL)?.remove();
  };
};

/** The element that carries the label, and makes sure a frame happens at all. */
const LABEL = "domicile-band-label";

/**
 * How many times a band has been shown, so the shape below always changes.
 *
 * The *colour* is not enough on its own: a band asked for twice running — a
 * one-band chrome, or a frame the compositor could not use — is painted the
 * same colour both times, and setting a style to the value it already holds is
 * not a change. Chromium invalidates nothing, paints nothing, and commits
 * nothing, and the compositor's question stands for ever. That is the frozen
 * chrome this exists to prevent, reached by the very code meant to prevent it.
 */
let shown = 0;

/**
 * Say this frame is `band`, and guarantee there is a frame to say it in.
 *
 * The colour is the label the compositor reads. The height is the guarantee:
 * what is needed is a paint *invalidation* rather than a visible difference,
 * and alternating the height is one the compositor cannot see — the pixel it
 * reads is the top-left one, which is inside the element at either height, and
 * the colour there is the label exactly rather than the label blended with
 * anything.
 */
const label = (band: number): void => {
  shown += 1;
  const marker = document.getElementById(LABEL) ?? mount();
  marker.style.backgroundColor = bandLabelColour(band);
  marker.style.blockSize = shown % 2 === 0 ? "1px" : "2px";
};

/** The label element, created the first time a band is asked for. */
const mount = (): HTMLElement => {
  const marker = document.createElement("div");
  marker.id = LABEL;
  // Fixed at the origin, because the origin is where the compositor reads it:
  // the top-left pixel of the picture the page commits.
  marker.style.position = "fixed";
  marker.style.inlineSize = "1px";
  marker.style.insetBlockStart = "0";
  marker.style.insetInlineStart = "0";
  // Over whatever the shell drew there, so the pixel is the label rather than
  // the label blended with a background.
  marker.style.zIndex = "2147483647";
  // Out of the way of everything a shell does with the page: it takes no
  // pointer, and `elementFromPoint` sees through it.
  marker.style.pointerEvents = "none";
  document.body.append(marker);
  return marker;
};
