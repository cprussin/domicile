// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/common/cursor_shape.h"

#include <string_view>
#include <vector>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Shape = mojom::CursorShape;

// THE POINT OF THIS FILE IS THE THIRD TEST, and the first two are what make its
// failure readable. The compositor's `CursorShape` (domicile_protocol), this
// header's list and `mojom::CursorShape` are three spellings of one closed set,
// and nothing but a test makes them agree. A shape that loses its wire name
// does not fail a build: it drops a cursor at runtime, on one client, with
// nothing said -- which is the failure mode the whole change is about.

TEST(CursorShapeTest, AWireNameBecomesTheShapeItNames) {
  // The four spellings that could each be got wrong on their own: the one that
  // is not a CSS keyword at all, the one that is a C++ keyword-ish default, a
  // hyphenated one, and a compass one -- `ne-resize` and `nesw-resize` differ
  // by two characters and mean different cursors.
  EXPECT_EQ(CursorShapeFromWire<Shape>("none"), Shape::kNone);
  EXPECT_EQ(CursorShapeFromWire<Shape>("default"), Shape::kDefault);
  EXPECT_EQ(CursorShapeFromWire<Shape>("context-menu"), Shape::kContextMenu);
  EXPECT_EQ(CursorShapeFromWire<Shape>("ne-resize"), Shape::kNeResize);
  EXPECT_EQ(CursorShapeFromWire<Shape>("nesw-resize"), Shape::kNeswResize);
}

TEST(CursorShapeTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // A typo, a CSS keyword that is real but not one a client can ask for, the
  // empty string, and a name with the right letters in the wrong shape. None
  // of these may become a cursor: `element.style.cursor = "pointr"` is a no-op
  // in CSS, so a value that gets this far unchecked is an arrow where a hand
  // should be and nothing anywhere saying why.
  EXPECT_EQ(CursorShapeFromWire<Shape>("pointr"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("auto"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>(""), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("NONE"), std::nullopt);
  EXPECT_EQ(CursorShapeFromWire<Shape>("ne_resize"), std::nullopt);
}

TEST(CursorShapeTest, EveryShapeHasExactlyOneWireNameAndRoundTrips) {
  // Built from the same list the codec is, so this cannot check the list
  // against itself: what it checks is the list against `mojom::CursorShape`,
  // whose `kMaxValue` is generated from the mojom rather than from here. A
  // variant added to the mojom and not to the list fails on the count; one
  // whose name does not come back fails on the round trip.
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
