// What a client can ask the chrome to show over its window.
//
// The shapes `wp_cursor_shape_v1` defines, named as the CSS `cursor` keyword
// the chrome assigns, plus `none` for a client that hides the cursor. Mirrors
// `domicile_protocol::CursorShape`.
//
// **A schema rather than a union, because this is the one thing on the typed
// surface that is still a string the engine can get wrong.** WebIDL has enums,
// and `DomicileAppEvent.cursor` is not one — it is a `DOMString` the browser
// process copies out of the compositor's JSON without looking at it. So the
// value that reaches the page can be anything, and a keyword CSS does not know
// is not an error anywhere: `element.style.cursor = "pointr"` is a no-op, and
// the symptom is an arrow where a hand should be, on one client, with nothing
// said. Parsing it here is what turns that into a stack.
//
// Its own module rather than a member of `protocol.ts` because both halves of
// the SDK need it and only one of them is the wire: `protocol.ts` parses the
// compositor's JSON for the headless harness, and `bridge.ts` parses this same
// keyword off a DOM event. One list, two readers.

import { z } from "zod";

export const cursorShapeSchema = z.enum([
  "none",
  "default",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "e-resize",
  "n-resize",
  "ne-resize",
  "nw-resize",
  "s-resize",
  "se-resize",
  "sw-resize",
  "w-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "col-resize",
  "row-resize",
  "all-scroll",
  "zoom-in",
  "zoom-out",
]);

/** A CSS `cursor` keyword a client can ask the chrome to show over its app. */
export type CursorShape = z.infer<typeof cursorShapeSchema>;
