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

using Heard = std::vector<DeskPointerAt>;

DeskPointer::Moved Into(Heard* heard) {
  return base::BindRepeating(
      [](Heard* heard, const DeskPointerAt& at) { heard->push_back(at); },
      base::Unretained(heard));
}

DeskPointerAt On(float x, float y) {
  return DeskPointerAt{gfx::PointF(x, y), {}};
}

DeskPointerAt Off() {
  return DeskPointerAt();
}

// Every control channel hears it: there is one per shell page.
TEST(DeskPointerTest, EveryListenerHearsWhereThePointerIs) {
  DeskPointer pointer;
  Heard left;
  Heard right;
  pointer.AddListener(Into(&left));
  pointer.AddListener(Into(&right));

  pointer.MovedTo(On(12.5, 3));
  pointer.MovedTo(Off());

  const Heard expected{On(12.5, 3), Off()};
  EXPECT_EQ(left, expected);
  EXPECT_EQ(right, expected);
}

// aura restates a still pointer after a window changes; the compositor need
// not hear it again.
TEST(DeskPointerTest, APlaceThePointerIsAlreadyAtTellsNobody) {
  DeskPointer pointer;
  Heard heard;
  pointer.AddListener(Into(&heard));

  pointer.MovedTo(On(1, 2));
  pointer.MovedTo(On(1, 2));
  pointer.MovedTo(Off());
  pointer.MovedTo(Off());

  EXPECT_EQ(heard, (Heard{On(1, 2), Off()}));
}

// A browser window that moves under a still pointer moves the pointer on its
// page, so the compositor hears it though the desk point is the same.
TEST(DeskPointerTest, AWindowMovingUnderTheSamePlaceIsHeard) {
  DeskPointer pointer;
  Heard heard;
  pointer.AddListener(Into(&heard));
  const DeskPointerAt left{gfx::PointF(1, 2), {{"1", gfx::PointF(0.25, 0.5)}}};
  const DeskPointerAt right{gfx::PointF(1, 2), {{"1", gfx::PointF(0.5, 0.5)}}};

  pointer.MovedTo(left);
  pointer.MovedTo(right);

  EXPECT_EQ(heard, (Heard{left, right}));
}

// A channel that closed is not told, or it would run on a deleted page's
// channel.
TEST(DeskPointerTest, ARemovedListenerHearsNothing) {
  DeskPointer pointer;
  Heard heard;
  const DeskPointer::ListenerId listener = pointer.AddListener(Into(&heard));

  pointer.RemoveListener(listener);
  pointer.MovedTo(On(1, 2));

  EXPECT_TRUE(heard.empty());
}

}  // namespace
}  // namespace domicile
