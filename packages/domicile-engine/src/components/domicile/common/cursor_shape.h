// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_
#define COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// The cursors a client can ask for, and the one place a wire name becomes one.
//
// `wp_cursor_shape_v1`'s shapes, named as the CSS `cursor` keyword the chrome
// assigns, plus `none` for a client that hides the cursor. The same closed set
// as `domicile_protocol::CursorShape` on the compositor's side and
// `cursorShapeSchema` in `@domicile/chrome-sdk` on the page's.
//
// WHY THIS IS A LIST AND NOT A `std::string`. It arrives as JSON over the
// compositor's socket and used to be copied straight through: browser to mojo
// to `DomicileAppEvent.cursor` to the page, with nothing on the way asking
// whether it named anything. A keyword CSS does not know is not an error
// anywhere -- `element.style.cursor = "pointr"` is a no-op -- so the symptom of
// a name gone wrong is an arrow where a hand should be, over one client, with
// nothing said. `DISCRIMINATED_UNIONS.md` is the rule: the memory format is an
// enum, and a wire string becomes one in an explicit codec at the boundary.
// This is that codec, and `ControlChannel::DispatchLine` is that boundary.
//
// AN X-MACRO RATHER THAN TWO SWITCH STATEMENTS, because there are two of them
// and they must not be able to disagree. The browser turns a wire name into a
// shape; Blink turns a shape back into the string the page reads off the
// event. Both are generated from the list below, so a shape that gains a name
// in one direction cannot lack one in the other. The templates are what let
// the same list serve `domicile::mojom::CursorShape` and its `-blink` variant,
// which are two C++ types with one set of enumerators.
//
// `cursor_shape_unittest.cc` checks the list against the mojom's own
// `kMaxValue`, which is the one number here that this file cannot get wrong.

// The closed set. Order matches `domicile_protocol::CursorShape` and
// `mojom::CursorShape`; the wire names are what the compositor serialises and
// what CSS reads.
#define DOMICILE_CURSOR_SHAPES(X) \
  X(kNone, "none")                \
  X(kDefault, "default")          \
  X(kContextMenu, "context-menu") \
  X(kHelp, "help")                \
  X(kPointer, "pointer")          \
  X(kProgress, "progress")        \
  X(kWait, "wait")                \
  X(kCell, "cell")                \
  X(kCrosshair, "crosshair")      \
  X(kText, "text")                \
  X(kVerticalText, "vertical-text") \
  X(kAlias, "alias")              \
  X(kCopy, "copy")                \
  X(kMove, "move")                \
  X(kNoDrop, "no-drop")           \
  X(kNotAllowed, "not-allowed")   \
  X(kGrab, "grab")                \
  X(kGrabbing, "grabbing")        \
  X(kEResize, "e-resize")         \
  X(kNResize, "n-resize")         \
  X(kNeResize, "ne-resize")       \
  X(kNwResize, "nw-resize")       \
  X(kSResize, "s-resize")         \
  X(kSeResize, "se-resize")       \
  X(kSwResize, "sw-resize")       \
  X(kWResize, "w-resize")         \
  X(kEwResize, "ew-resize")       \
  X(kNsResize, "ns-resize")       \
  X(kNeswResize, "nesw-resize")   \
  X(kNwseResize, "nwse-resize")   \
  X(kColResize, "col-resize")     \
  X(kRowResize, "row-resize")     \
  X(kAllScroll, "all-scroll")     \
  X(kZoomIn, "zoom-in")           \
  X(kZoomOut, "zoom-out")

namespace domicile {

// The shape a wire name names, or nothing if it names none of them.
//
// `std::nullopt` rather than a fallback to `kDefault`: a compositor that sent a
// name this build does not know is a disagreement worth a line in the log, and
// substituting an arrow for it is how the original defect looked from the
// page. The caller decides, and `DispatchLine` drops the message and says so.
template <typename CursorShapeEnum>
inline std::optional<CursorShapeEnum> CursorShapeFromWire(
    std::string_view name) {
#define DOMICILE_CURSOR_SHAPE_FROM_WIRE(shape, wire) \
  if (name == wire) {                                \
    return CursorShapeEnum::shape;                   \
  }
  DOMICILE_CURSOR_SHAPES(DOMICILE_CURSOR_SHAPE_FROM_WIRE)
#undef DOMICILE_CURSOR_SHAPE_FROM_WIRE
  return std::nullopt;
}

// The wire name of a shape. Total, unlike the other direction: every value of
// the enum is in the list, which is what the unit test asserts.
template <typename CursorShapeEnum>
inline std::string_view CursorShapeToWire(CursorShapeEnum shape) {
  switch (shape) {
#define DOMICILE_CURSOR_SHAPE_TO_WIRE(value, wire) \
  case CursorShapeEnum::value:                     \
    return wire;
    DOMICILE_CURSOR_SHAPES(DOMICILE_CURSOR_SHAPE_TO_WIRE)
#undef DOMICILE_CURSOR_SHAPE_TO_WIRE
  }
  // NOT a fallback to an arrow, which is the defect this file exists to stop
  // arriving silently. An `enum class : int32_t` can hold a value no case
  // names, but this one cannot get here holding one: mojo checks an enum on
  // deserialisation and rejects the message, so a value reaching this line came
  // from a cast in this repository and is a bug rather than a peer's doing.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_
