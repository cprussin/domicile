// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/device_choices.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Ids = std::vector<int32_t>;
using Indices = std::vector<size_t>;

TEST(DeviceChoicesTest, ListedDevicesEachGetAnId) {
  DeviceChoices choices;
  choices.Listed(3);
  EXPECT_EQ(choices.ids(), (Ids{1, 2, 3}));
}

TEST(DeviceChoicesTest, AnAddedDeviceGetsANewId) {
  DeviceChoices choices;
  choices.Listed(2);
  choices.Added(2);
  EXPECT_EQ(choices.ids(), (Ids{1, 2, 3}));
}

// The shell answers with ids from an older list, so a removal must not shift
// the ids of the devices after it.
TEST(DeviceChoicesTest, ARemovedDeviceKeepsTheOthersIds) {
  DeviceChoices choices;
  choices.Listed(3);
  choices.Removed(0);
  EXPECT_EQ(choices.ids(), (Ids{2, 3}));
}

// A device plugged back in is a new device to the controller, so an answer
// naming its old id must not pick it.
TEST(DeviceChoicesTest, AnIdIsNeverReused) {
  DeviceChoices choices;
  choices.Listed(1);
  choices.Removed(0);
  choices.Added(0);
  EXPECT_EQ(choices.ids(), (Ids{2}));
}

TEST(DeviceChoicesTest, ListingAgainGivesNewIds) {
  DeviceChoices choices;
  choices.Listed(2);
  choices.Listed(1);
  EXPECT_EQ(choices.ids(), (Ids{3}));
}

TEST(DeviceChoicesTest, AChosenIdIsTheDevicesCurrentIndex) {
  DeviceChoices choices;
  choices.Listed(3);
  choices.Removed(0);
  EXPECT_EQ(choices.IndicesOf({3}, /*multiple=*/false), (Indices{1}));
}

TEST(DeviceChoicesTest, SeveralChosenAreInListOrder) {
  DeviceChoices choices;
  choices.Listed(3);
  EXPECT_EQ(choices.IndicesOf({3, 1}, /*multiple=*/true), (Indices{0, 2}));
}

// The user picked it as it was unplugged: nothing is chosen, which the
// chooser treats as a cancel.
TEST(DeviceChoicesTest, ARemovedDeviceIsNotChosen) {
  DeviceChoices choices;
  choices.Listed(2);
  choices.Removed(1);
  EXPECT_EQ(choices.IndicesOf({2}, /*multiple=*/false), (Indices{}));
}

// The element throws for each of these first, so arriving here they come from
// a bad renderer.
TEST(DeviceChoicesTest, AnAnswerThatDoesNotFitIsNone) {
  DeviceChoices choices;
  choices.Listed(2);
  EXPECT_EQ(choices.IndicesOf({}, /*multiple=*/true), std::nullopt);
  EXPECT_EQ(choices.IndicesOf({1, 2}, /*multiple=*/false), std::nullopt);
  EXPECT_EQ(choices.IndicesOf({1, 1}, /*multiple=*/true), std::nullopt);
  EXPECT_EQ(choices.IndicesOf({3}, /*multiple=*/false), std::nullopt);
  EXPECT_EQ(choices.IndicesOf({0}, /*multiple=*/false), std::nullopt);
}

}  // namespace
}  // namespace domicile
