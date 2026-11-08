// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_pointer_hiding.h"

#include <vector>

#include "base/functional/bind.h"
#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Heard = std::vector<PointerHidingSettings>;

DeskPointerHiding::Changed Into(Heard* heard) {
  return base::BindRepeating(
      [](Heard* heard, const PointerHidingSettings& settings) {
        heard->push_back(settings);
      },
      base::Unretained(heard));
}

constexpr PointerHidingSettings kAfterASecond{.after = base::Seconds(1),
                                              .when_typing = true};

// Every shell page's channel restates the same settings; the pointer hears
// them once.
TEST(DeskPointerHidingTest, TheSameSettingsAgainTellNobody) {
  DeskPointerHiding hiding;
  Heard heard;
  hiding.AddListener(Into(&heard));

  hiding.Set(kAfterASecond);
  hiding.Set(kAfterASecond);
  hiding.Set(PointerHidingSettings());

  EXPECT_EQ(heard, (Heard{kAfterASecond, PointerHidingSettings()}));
}

// The pointer may start listening after the first page's channel set them.
TEST(DeskPointerHidingTest, ALateListenerReadsTheSettingsNow) {
  DeskPointerHiding hiding;
  hiding.Set(kAfterASecond);
  Heard heard;

  const DeskPointerHiding::ListenerId listener =
      hiding.AddListener(Into(&heard));
  EXPECT_EQ(hiding.Now(), kAfterASecond);

  hiding.RemoveListener(listener);
  hiding.Set(PointerHidingSettings());
  EXPECT_TRUE(heard.empty());
}

}  // namespace
}  // namespace domicile
