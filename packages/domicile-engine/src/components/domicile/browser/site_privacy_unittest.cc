// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/site_privacy.h"

#include <string>
#include <utility>
#include <vector>

#include "components/prefs/testing_pref_service.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

class SitePrivacyTest : public testing::Test {
 protected:
  SitePrivacyTest() { RegisterSitePrivacyPrefs(prefs_.registry()); }

  TestingPrefServiceSimple prefs_;
};

TEST_F(SitePrivacyTest, AProfileBlocksOnStandardUntilTheConfigSays) {
  EXPECT_EQ(ProfileAdBlocking(prefs_), AdBlockingMode::kStandard);
  SetProfileAdBlocking(prefs_, AdBlockingMode::kStrict);
  EXPECT_EQ(ProfileAdBlocking(prefs_), AdBlockingMode::kStrict);
}

TEST_F(SitePrivacyTest, ASiteKeepsItsOwnModeUntilItIsRemoved) {
  EXPECT_EQ(SiteAdBlocking(prefs_, "example.com"), std::nullopt);
  SetSiteAdBlocking(prefs_, "example.com", AdBlockingMode::kOff);
  EXPECT_EQ(SiteAdBlocking(prefs_, "example.com"), AdBlockingMode::kOff);
  EXPECT_EQ(SiteAdBlocking(prefs_, "example.org"), std::nullopt);
  SetSiteAdBlocking(prefs_, "example.com", std::nullopt);
  EXPECT_EQ(SiteAdBlocking(prefs_, "example.com"), std::nullopt);
}

TEST_F(SitePrivacyTest, ListsEachSiteWithItsOwnModeBySite) {
  EXPECT_TRUE(SitesWithOwnAdBlocking(prefs_).empty());
  SetSiteAdBlocking(prefs_, "nytimes.com", AdBlockingMode::kOff);
  SetSiteAdBlocking(prefs_, "chase.com", AdBlockingMode::kStrict);
  const std::vector<std::pair<std::string, AdBlockingMode>> expected = {
      {"chase.com", AdBlockingMode::kStrict},
      {"nytimes.com", AdBlockingMode::kOff}};
  EXPECT_EQ(SitesWithOwnAdBlocking(prefs_), expected);
}

TEST_F(SitePrivacyTest, APagesSiteIsItsRegistrableDomain) {
  EXPECT_EQ(PrivacySiteOf(GURL("https://www.nytimes.com/2026/11/26/x.html")),
            "nytimes.com");
  EXPECT_EQ(PrivacySiteOf(GURL("https://news.bbc.co.uk/")), "bbc.co.uk");
  // A private registry's, as a request's third party is judged.
  EXPECT_EQ(PrivacySiteOf(GURL("https://alice.github.io/blog")),
            "alice.github.io");
}

TEST_F(SitePrivacyTest, AnAddressWithNoDomainIsItsHost) {
  EXPECT_EQ(PrivacySiteOf(GURL("http://127.0.0.1:8080/page")), "127.0.0.1");
  EXPECT_EQ(PrivacySiteOf(GURL("http://localhost:9/")), "localhost");
}

TEST_F(SitePrivacyTest, APageThatIsNotAWebsiteHasNoSite) {
  EXPECT_EQ(PrivacySiteOf(GURL("domicile://shell/")), "");
  EXPECT_EQ(PrivacySiteOf(GURL("file:///home/me/page.html")), "");
  EXPECT_EQ(PrivacySiteOf(GURL("about:blank")), "");
}

TEST_F(SitePrivacyTest, EachModeHasTheConfigsName) {
  for (const AdBlockingMode mode :
       {AdBlockingMode::kStandard, AdBlockingMode::kStrict,
        AdBlockingMode::kOff}) {
    EXPECT_EQ(AdBlockingModeNamed(AdBlockingModeName(mode)), mode);
  }
  EXPECT_EQ(AdBlockingModeName(AdBlockingMode::kStrict), "strict");
  EXPECT_EQ(AdBlockingModeNamed("aggressive"), std::nullopt);
}

}  // namespace
}  // namespace domicile
