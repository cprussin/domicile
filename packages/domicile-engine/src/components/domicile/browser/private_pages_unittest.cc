// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/private_pages.h"

#include "base/functional/bind.h"
#include "base/test/task_environment.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

class PrivatePagesTest : public testing::Test {
 protected:
  void End() { ++ends_; }

  base::test::SingleThreadTaskEnvironment task_environment_;
  int ends_ = 0;
  PrivatePages pages_{
      base::BindRepeating(&PrivatePagesTest::End, base::Unretained(this))};
};

TEST_F(PrivatePagesTest, EndsOnALaterTaskAfterTheLastPageCloses) {
  // Later, because the last page closes from inside its own WebContents'
  // destruction.
  pages_.Opened();
  pages_.Opened();
  pages_.Closed();
  task_environment_.RunUntilIdle();
  EXPECT_EQ(ends_, 0);

  pages_.Closed();
  EXPECT_EQ(ends_, 0);
  task_environment_.RunUntilIdle();
  EXPECT_EQ(ends_, 1);
}

TEST_F(PrivatePagesTest, APageOpenedBeforeTheEndRunsKeepsItOpen) {
  // A private page's link opening a private window can close the page and
  // make the window in one task.
  pages_.Opened();
  pages_.Closed();
  pages_.Opened();
  task_environment_.RunUntilIdle();

  EXPECT_EQ(ends_, 0);
}

TEST_F(PrivatePagesTest, EndsAgainAfterTheNextPagesClose) {
  pages_.Opened();
  pages_.Closed();
  task_environment_.RunUntilIdle();
  pages_.Opened();
  pages_.Closed();
  task_environment_.RunUntilIdle();

  EXPECT_EQ(ends_, 2);
}

}  // namespace
}  // namespace domicile
