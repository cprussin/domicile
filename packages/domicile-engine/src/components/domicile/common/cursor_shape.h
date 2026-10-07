// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_
#define COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// The cursors a client can request, and the codec from wire names to shapes.
//
// The shapes of `wp_cursor_shape_v1`, named by their CSS `cursor` keyword,
// plus `none` for a hidden cursor. The same set as
// `domicile_protocol::CursorShape` in the compositor and `cursorShapeSchema`
// in `@domicile-desktop/sdk`.
//
// An enum rather than a string, because CSS silently ignores an unknown
// cursor keyword. Per docs/guidelines/DISCRIMINATED_UNIONS.md, the wire string
// is decoded here, at the boundary in `ControlChannel::DispatchLine`.
//
// An X-macro generates both directions (browser decode, Blink encode) from one
// list so they cannot disagree. The templates let the list serve both
// `domicile::mojom::CursorShape` and its `-blink` variant.
//
// `cursor_shape_unittest.cc` checks the list against the mojom's `kMaxValue`.

// Order matches `domicile_protocol::CursorShape` and `mojom::CursorShape`.
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

// The shape for a wire name, or `std::nullopt` if unknown.
//
// No fallback to `kDefault`: an unknown name means the compositor and this
// build disagree, which the caller should log. `DispatchLine` drops the
// message.
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

// The wire name of a shape. Every enum value is in the list, as the unit test
// asserts.
template <typename CursorShapeEnum>
inline std::string_view CursorShapeToWire(CursorShapeEnum shape) {
  switch (shape) {
#define DOMICILE_CURSOR_SHAPE_TO_WIRE(value, wire) \
  case CursorShapeEnum::value:                     \
    return wire;
    DOMICILE_CURSOR_SHAPES(DOMICILE_CURSOR_SHAPE_TO_WIRE)
#undef DOMICILE_CURSOR_SHAPE_TO_WIRE
  }
  // No fallback to an arrow. Mojo rejects out-of-range enums on
  // deserialization, so reaching here means a bad cast in this repository.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_CURSOR_SHAPE_H_
