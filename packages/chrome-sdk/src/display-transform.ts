// Display rotations: the four `wl_output.transform` rotations, named as the
// config file writes them. Mirrors `domicile_protocol::DisplayTransform`;
// `scripts/test-display-transforms-agree.sh` checks that all copies match in
// membership and order.
//
// Rotations count counterclockwise, as in `wl_output`, kanshi and sway:
// `rotate-90` suits a panel mounted a quarter turn clockwise.
//
// The engine exposes `transform` as a `DOMString`, not a WebIDL enum, to avoid
// patching another `.idl` into Chromium's build lists, so it is parsed here.
// An unknown name falls back to `normal` rather than failing: it arrives as
// part of the whole desktop, and failing would drop every display.
//
// A separate module because `protocol.ts` (the wire) and shells reading
// `DomicileDisplay.transform` both parse it.

import { z } from "zod";

export const displayTransformSchema = z.enum([
  "normal",
  "rotate-90",
  "rotate-180",
  "rotate-270",
]);

/** How a display's content is rotated. */
export type DisplayTransform = z.infer<typeof displayTransformSchema>;

/**
 * Parse `DomicileDisplay.transform`, falling back to `normal` for an unknown
 * name (see the module comment).
 */
export const asDisplayTransform = (named: string): DisplayTransform =>
  displayTransformSchema.safeParse(named).data ?? "normal";
