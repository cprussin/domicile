// What a client can ask the chrome to show over its window.
//
// The shapes `wp_cursor_shape_v1` defines, named as the CSS `cursor` keyword
// the chrome assigns, plus `none` for a client that hides the cursor. Mirrors
// `domicile_protocol::CursorShape`.
//
// **A schema rather than a union, because the DOM is a boundary.** The set is
// closed at every point it passes through now: `domicile_protocol::CursorShape`
// is what the compositor serialises, `components/domicile/common/cursor_shape.h`
// is what the browser process refuses an unknown name against when it reads the
// socket, and `domicile_cursor_shape.idl` is a WebIDL `enum`, so
// `DomicileAppCursorEvent.cursor` is a member of it by construction rather than
// a `DOMString` that happens to hold one.
//
// So why parse at all. Because the engine and this package are not one deploy
// unit: `engine-release.nix` pins an engine tarball, a shell gets this SDK from
// `bun install`, and the two move on their own schedules. A shape added here
// before an engine carrying it ships arrives from a `DomicileCursorShape` that
// does not name it — the one skew the closed set cannot close from inside. It
// matters because a keyword CSS does not know is not an error anywhere:
// `element.style.cursor = "pointr"` is a no-op, and the symptom is an arrow
// where a hand should be, on one client, with nothing said. Parsing it here is
// what turns that into a stack.
//
// `scripts/test-cursor-shapes-agree.sh` compares all four lists, for membership
// AND order, without building anything.
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
