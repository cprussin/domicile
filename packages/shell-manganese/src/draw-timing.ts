/**
 * How long a client's frame took to reach the screen.
 *
 * **Empty, and that is a gap rather than a tidy-up.** This shell used to draw a
 * client's pixels into a canvas and priced that draw. A client's buffer now
 * goes to the display compositor and the page embeds the surface, so no drawing
 * happens here to time.
 *
 * Kept rather than deleted because it is one half of the instrument for the
 * requirement this fork answers to — that the compositor add no latency a user
 * can see. See `BridgeClient.roundTrip` for the other half and where both have
 * to be rebuilt. It outlived the registry it used to hang off, which held it
 * for no better reason than that the registry was the last thing in this shell
 * that touched a client's pixels.
 */

import { SampleWindow } from "@domicile/chrome-sdk/sample-window";

export const drawTiming = new SampleWindow();
