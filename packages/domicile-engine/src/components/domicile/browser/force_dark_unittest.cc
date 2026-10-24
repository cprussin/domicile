// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/force_dark.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// The sites are process-wide, so each test clears them.
class ForceDarkTest : public testing::Test {
 protected:
  ~ForceDarkTest() override { SetForceDarkSites({}); }
};

TEST_F(ForceDarkTest, ANamedSiteIsDarkWhileTheDeskIs) {
  SetForceDarkSites({"mail.google.com"});

  EXPECT_TRUE(ForcesDark(GURL("https://mail.google.com/mail/u/0/"),
                         /*dark=*/true));
  EXPECT_FALSE(ForcesDark(GURL("https://mail.google.com/mail/u/0/"),
                          /*dark=*/false));
}

TEST_F(ForceDarkTest, ASiteCoversItsSubdomainsAndNoOtherHost) {
  SetForceDarkSites({"google.com"});

  EXPECT_TRUE(ForcesDark(GURL("https://mail.google.com/"), /*dark=*/true));
  EXPECT_FALSE(ForcesDark(GURL("https://notgoogle.com/"), /*dark=*/true));
  EXPECT_FALSE(ForcesDark(GURL("https://example.com/"), /*dark=*/true));
}

}  // namespace
}  // namespace domicile
