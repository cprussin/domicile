// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/cursor_shape.h"

#include <string_view>
#include <vector>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Shape = mojom::CursorShape;

// `domicile_protocol::CursorShape`, this header's list and `mojom::CursorShape`
// must name the same set. Only a test checks that: a missing wire name does not
// fail the build, it silently drops a cursor at runtime.

TEST(CursorShapeTest, AWireNameBecomesTheShapeItNames) {
  // A sample of easy-to-mistype names. `ne-resize` and `nesw-resize` are
  // different cursors.
  EXPECT_EQ(CursorShapeFromWire<Shape>("none"), Shape::kNone);
  EXPECT_EQ(CursorShapeFromWire<Shape>("default"), Shape::kDefault);
  EXPECT_EQ(CursorShapeFromWire<Shape>("context-menu"), Shape::kContextMenu);
  EXPECT_EQ(CursorShapeFromWire<Shape>("ne-resize"), Shape::kNeResize);
  EXPECT_EQ(CursorShapeFromWire<Shape>("nesw-resize"), Shape::kNeswResize);
}

TEST(CursorShapeTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // CSS ignores an unknown cursor keyword without an error, so an unchecked
  // bad name would show the wrong cursor with no diagnostic.
  EXPECT_EQ(CursorShapeFromWire<Shape>("pointr"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("auto"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>(""), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("NONE"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("ne_resize"), std::nullopt);
}

TEST(CursorShapeTest, EveryShapeHasExactlyOneWireNameAndRoundTrips) {
  // Checks the list against `mojom::CursorShape`'s generated `kMaxValue`. A
  // mojom variant missing from the list fails the count; a wrong name fails
  // the round trip.
  std::vector<Shape> named;
#define DOMICILE_CURSOR_SHAPE_CASE(shape, wire)                      \
  EXPECT_EQ(CursorShapeToWire(Shape::shape), std::string_view(wire)); \
  EXPECT_EQ(CursorShapeFromWire<Shape>(wire), Shape::shape);          \
  named.push_back(Shape::shape);
  DOMICILE_CURSOR_SHAPES(DOMICILE_CURSOR_SHAPE_CASE)
#undef DOMICILE_CURSOR_SHAPE_CASE

  EXPECT_EQ(named.size(),
            static_cast<size_t>(Shape::kMaxValue) -
                static_cast<size_t>(Shape::kMinValue) + 1u)
      << "a cursor in the mojom has no wire name here, or the other way round";
}

}  // namespace
}  // namespace domicile
