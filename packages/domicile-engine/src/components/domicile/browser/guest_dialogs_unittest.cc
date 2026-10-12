// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/guest_dialogs.h"

#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// What a dialog's page was told: OK or Cancel, and a prompt's text.
using Result = std::optional<std::pair<bool, std::u16string>>;

// A page's dialog: records what it was told in `result`.
GuestDialogs::Closed Page(Result& result) {
  return base::BindOnce(
      [](Result* result, bool accepted, const std::u16string& user_input) {
        *result = std::make_pair(accepted, user_input);
      },
      &result);
}

// The shell: keeps the answer callback in `answer`.
GuestDialogs::Show Shell(GuestDialogs::Closed& answer) {
  return base::BindOnce(
      [](GuestDialogs::Closed* answer, GuestDialogs::Closed given) {
        *answer = std::move(given);
      },
      &answer);
}

TEST(GuestDialogsTest, TheShellsAnswerReachesThePage) {
  GuestDialogs dialogs;
  Result result;
  GuestDialogs::Closed answer;
  EXPECT_TRUE(dialogs.Open(Page(result), Shell(answer)));
  EXPECT_FALSE(result);
  std::move(answer).Run(true, u"typed");
  EXPECT_EQ(result, std::make_pair(true, std::u16string(u"typed")));
}

// A page in another process can open one while the first is up. The shell
// shows one at a time, so the second is refused for content to dismiss.
TEST(GuestDialogsTest, ASecondDialogIsRefusedWhileOneIsOpen) {
  GuestDialogs dialogs;
  Result first;
  GuestDialogs::Closed first_answer;
  dialogs.Open(Page(first), Shell(first_answer));
  Result second;
  GuestDialogs::Closed second_answer;
  EXPECT_FALSE(dialogs.Open(Page(second), Shell(second_answer)));
  EXPECT_FALSE(second_answer);
}

TEST(GuestDialogsTest, AnotherDialogMayOpenOnceOneIsAnswered) {
  GuestDialogs dialogs;
  Result first;
  GuestDialogs::Closed first_answer;
  dialogs.Open(Page(first), Shell(first_answer));
  std::move(first_answer).Run(false, u"");
  Result second;
  GuestDialogs::Closed second_answer;
  EXPECT_TRUE(dialogs.Open(Page(second), Shell(second_answer)));
}

TEST(GuestDialogsTest, CancelTellsThePageCancel) {
  GuestDialogs dialogs;
  Result result;
  GuestDialogs::Closed answer;
  dialogs.Open(Page(result), Shell(answer));
  EXPECT_TRUE(dialogs.Cancel());
  EXPECT_EQ(result, std::make_pair(false, std::u16string()));
}

// The caller withdraws the shell's dialog only when one was open.
TEST(GuestDialogsTest, CancelWithNothingOpenSaysSo) {
  GuestDialogs dialogs;
  EXPECT_FALSE(dialogs.Cancel());
}

// The shell may answer a dialog after the page navigated away from it. That
// answer must not close the next dialog.
TEST(GuestDialogsTest, AnAnswerToACanceledDialogIsIgnored) {
  GuestDialogs dialogs;
  Result first;
  GuestDialogs::Closed first_answer;
  dialogs.Open(Page(first), Shell(first_answer));
  dialogs.Cancel();
  Result second;
  GuestDialogs::Closed second_answer;
  dialogs.Open(Page(second), Shell(second_answer));
  std::move(first_answer).Run(true, u"late");
  EXPECT_EQ(first, std::make_pair(false, std::u16string()));
  EXPECT_FALSE(second);
}

}  // namespace
}  // namespace domicile
