// Cursor shapes a client can ask the chrome to show over its window.
//
// The `wp_cursor_shape_v1` shapes, named by their CSS `cursor` keyword, plus
// `none`. Mirrors `domicile_protocol::CursorShape`;
// `scripts/test-cursor-shapes-agree.sh` checks that all copies match in
// membership and order.
//
// The engine already restricts the value to this set, but the engine and the
// SDK ship separately. Parsing catches a version skew that would otherwise
// fail silently, since CSS ignores an unknown `cursor` keyword.
//
// A separate module because `protocol.ts` (the wire) and
// `domicile-client.ts` (DOM events) both parse it.

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
