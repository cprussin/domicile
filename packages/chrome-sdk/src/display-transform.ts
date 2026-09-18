// Which way up a monitor is bolted to the desk.
//
// The four `wl_output.transform` rotations, spelled the way the config file
// writes them. Mirrors `domicile_protocol::DisplayTransform`.
//
// **Named for the turn the content takes, not the one the panel did.** That is
// the `wl_output` convention and the config's: `transform_90` is an output
// rotated a quarter turn anticlockwise, so what is drawn on it has to go a
// quarter turn *clockwise* to come out upright, and `rotate-90` names that
// clockwise turn. A shell applies it as written.
//
// **A schema rather than a union, and for a weaker reason than
// `cursor-shape.ts` next door.** That one parses a WebIDL `enum`, which is a
// member by construction, and parses anyway because the engine and this SDK
// are not one deploy unit. This one parses a `DOMString`:
// `domicile_display.idl` declares `transform` as a string rather than an enum,
// because an enum attribute would be a second `.idl` and a second entry in
// Chromium's own `bindings/idl_in_modules.gni`, which the fork carries as a
// patch. So the set is closed on the compositor's side and on this one, and
// open in the middle — and this is where it closes again.
//
// `normal` is what an unknown name becomes, and it is a deliberate fallback
// rather than a refusal. `cursor_shape.h` refuses, because a cursor nobody
// knows is worth dropping a message over. A turn arrives as one field of a
// whole desktop, so refusing it would cost a shell every screen rather than
// one monitor's rotation — and `normal` is the arrangement that is right
// whenever there is nothing to turn, which is what a page produces if it never
// hears of transforms at all. The browser process falls back the same way on
// the way in, for the same reason.
//
// Its own module rather than a member of `protocol.ts` because both halves of
// the SDK need it and only one of them is the wire: `protocol.ts` parses the
// compositor's JSON for the headless harness, and a shell parses this same
// name off `DomicileDisplay.transform`. One list, two readers.
//
// `scripts/test-display-transforms-agree.sh` compares all five lists, for
// membership AND order, without building anything.

import { z } from "zod";

export const displayTransformSchema = z.enum([
  "normal",
  "rotate-90",
  "rotate-180",
  "rotate-270",
]);

/** Which way up a monitor is, as the turn the content takes. */
export type DisplayTransform = z.infer<typeof displayTransformSchema>;

/**
 * The turn a name names, or `normal` where it names none of them.
 *
 * For a reader holding a `DOMString` off `DomicileDisplay.transform`. See the
 * note above for why the fallback is `normal` rather than a refusal.
 */
export const asDisplayTransform = (named: string): DisplayTransform =>
  displayTransformSchema.safeParse(named).data ?? "normal";
