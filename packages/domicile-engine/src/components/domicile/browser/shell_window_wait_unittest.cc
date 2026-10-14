// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_window_wait.h"

#include <algorithm>
#include <cstddef>
#include <optional>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/test/task_environment.h"
#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

constexpr base::TimeDelta kPatience = base::Seconds(3);

class ShellWindowWaitTest : public testing::Test {
 protected:
  // Waits on a window that `look` finds in `states`, one per look, staying
  // in the last.
  void Wait(std::vector<ShellWindowState> states) {
    states_ = std::move(states);
    WhenTheShellWindowHasAPage(
        base::BindRepeating(&ShellWindowWaitTest::Look, base::Unretained(this)),
        kPatience,
        base::BindOnce([](std::optional<bool>* out,
                          bool has_a_page) { *out = has_a_page; },
                       &has_a_page_));
  }

  ShellWindowState Look() {
    const ShellWindowState state = states_[looks_];
    looks_ = std::min(looks_ + 1, states_.size() - 1);
    return state;
  }

  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::TimeSource::MOCK_TIME};
  std::vector<ShellWindowState> states_;
  size_t looks_ = 0;
  std::optional<bool> has_a_page_;
};

TEST_F(ShellWindowWaitTest, AnswersAtOnceWhenTheWindowShowsAPage) {
  Wait({ShellWindowState::kShowingAPage});
  EXPECT_EQ(has_a_page_, true);
}

TEST_F(ShellWindowWaitTest, AnswersAtOnceWhenThereIsNoWindow) {
  // No window is coming, so waiting would only delay the refusal.
  Wait({ShellWindowState::kAbsent});
  EXPECT_EQ(has_a_page_, false);
}

TEST_F(ShellWindowWaitTest, WaitsForAnOpeningWindowsFirstPage) {
  Wait({ShellWindowState::kOpening, ShellWindowState::kOpening,
        ShellWindowState::kShowingAPage});
  EXPECT_EQ(has_a_page_, std::nullopt);

  task_environment_.FastForwardBy(kPatience / 2);
  EXPECT_EQ(has_a_page_, true);
}

TEST_F(ShellWindowWaitTest, GivesUpOnAWindowThatNeverShowsAPage) {
  Wait({ShellWindowState::kOpening});

  task_environment_.FastForwardBy(kPatience - base::Milliseconds(1));
  EXPECT_EQ(has_a_page_, std::nullopt);

  task_environment_.FastForwardBy(base::Seconds(1));
  EXPECT_EQ(has_a_page_, false);
}

}  // namespace
}  // namespace domicile
