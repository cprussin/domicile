// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_pointer.h"

#include <optional>
#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/point_f.h"

namespace domicile {
namespace {

using Heard = std::vector<std::optional<gfx::PointF>>;

DeskPointer::Moved Into(Heard* heard) {
  return base::BindRepeating(
      [](Heard* heard, std::optional<gfx::PointF> at) { heard->push_back(at); },
      base::Unretained(heard));
}

// Every control channel hears it: there is one per shell page.
TEST(DeskPointerTest, EveryListenerHearsWhereThePointerIs) {
  DeskPointer pointer;
  Heard left;
  Heard right;
  pointer.AddListener(Into(&left));
  pointer.AddListener(Into(&right));

  pointer.MovedTo(gfx::PointF(12.5, 3));
  pointer.MovedTo(std::nullopt);

  const Heard expected{gfx::PointF(12.5, 3), std::nullopt};
  EXPECT_EQ(left, expected);
  EXPECT_EQ(right, expected);
}

// aura restates a still pointer after a window changes; the compositor need
// not hear it again.
TEST(DeskPointerTest, APlaceThePointerIsAlreadyAtTellsNobody) {
  DeskPointer pointer;
  Heard heard;
  pointer.AddListener(Into(&heard));

  pointer.MovedTo(gfx::PointF(1, 2));
  pointer.MovedTo(gfx::PointF(1, 2));
  pointer.MovedTo(std::nullopt);
  pointer.MovedTo(std::nullopt);

  EXPECT_EQ(heard, (Heard{gfx::PointF(1, 2), std::nullopt}));
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskPointerTest, ARemovedListenerHearsNothing) {
  DeskPointer pointer;
  Heard heard;
  const DeskPointer::ListenerId listener = pointer.AddListener(Into(&heard));

  pointer.RemoveListener(listener);
  pointer.MovedTo(gfx::PointF(1, 2));

  EXPECT_TRUE(heard.empty());
}

}  // namespace
}  // namespace domicile
