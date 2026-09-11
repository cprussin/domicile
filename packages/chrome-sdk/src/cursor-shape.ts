// What a client can ask the chrome to show over its window.
//
// The shapes `wp_cursor_shape_v1` defines, named as the CSS `cursor` keyword
// the chrome assigns, plus `none` for a client that hides the cursor. Mirrors
// `domicile_protocol::CursorShape`.
//
// **A schema rather than a union, because `DomicileAppEvent.cursor` is a
// `DOMString` and the DOM is a boundary.** The engine no longer copies a name
// through unread — `components/domicile/common/cursor_shape.h` is the same
// closed set, and the browser process refuses a name that is not one of these
// when it reads the compositor's socket — so what reaches the page is a member
// of this set by construction. What that does not make true is that *this*
// value came from there: an event is constructible by anything in the page,
// and `cursorShapeSchema.parse` is where it is read rather than trusted.
//
// It matters because a keyword CSS does not know is not an error anywhere:
// `element.style.cursor = "pointr"` is a no-op, and the symptom is an arrow
// where a hand should be, on one client, with nothing said. Parsing it here is
// what turns that into a stack.
//
// The one step left is the WebIDL `enum`, which would make the closed set
// visible to the page's own type system rather than only to the two ends of
// the wire. It needs a new .idl file registered in two files Chromium owns,
// which is a change to the patch series rather than to the fork's own sources.
//
// Its own module rather than a member of `protocol.ts` because both halves of
// the SDK need it and only one of them is the wire: `protocol.ts` parses the
// compositor's JSON for the headless harness, and `domicile-client.ts` parses
// this same keyword off a DOM event. One list, two readers.

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
