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
  EXPECT_TRUE(SitesWithOwnPrivacy(prefs_).empty());
  SetSiteAdBlocking(prefs_, "nytimes.com", AdBlockingMode::kOff);
  SetSiteAdBlocking(prefs_, "chase.com", AdBlockingMode::kStrict);
  const std::vector<std::pair<std::string, SitePrivacySettings>> sites =
      SitesWithOwnPrivacy(prefs_);
  ASSERT_EQ(sites.size(), 2u);
  EXPECT_EQ(sites[0].first, "chase.com");
  EXPECT_EQ(sites[0].second.block_ads_and_trackers, AdBlockingMode::kStrict);
  EXPECT_TRUE(sites[0].second.protections.empty());
  EXPECT_EQ(sites[1].first, "nytimes.com");
  EXPECT_EQ(sites[1].second.block_ads_and_trackers, AdBlockingMode::kOff);
}

TEST_F(SitePrivacyTest, AProfileHasEachProtectionAsTheConfigSays) {
  EXPECT_TRUE(ProfileProtection(prefs_, PageProtection::kHideDeviceDetails));
  EXPECT_TRUE(
      ProfileProtection(prefs_, PageProtection::kRemoveTrackingFromLinks));
  prefs_.SetBoolean(kHideDeviceDetailsPref, false);
  EXPECT_FALSE(ProfileProtection(prefs_, PageProtection::kHideDeviceDetails));
  EXPECT_TRUE(
      ProfileProtection(prefs_, PageProtection::kRemoveTrackingFromLinks));
}

TEST_F(SitePrivacyTest, ASiteKeepsEachProtectionOfItsOwnUntilRemoved) {
  constexpr PageProtection kDetails = PageProtection::kHideDeviceDetails;
  constexpr PageProtection kLinks = PageProtection::kRemoveTrackingFromLinks;
  EXPECT_EQ(SiteProtection(prefs_, "example.com", kDetails), std::nullopt);
  SetSiteProtection(prefs_, "example.com", kDetails, false);
  EXPECT_EQ(SiteProtection(prefs_, "example.com", kDetails), false);
  EXPECT_EQ(SiteProtection(prefs_, "example.com", kLinks), std::nullopt);
  EXPECT_EQ(SiteProtection(prefs_, "example.org", kDetails), std::nullopt);
  SetSiteProtection(prefs_, "example.com", kLinks, true);
  EXPECT_EQ(SiteProtection(prefs_, "example.com", kLinks), true);

  SetSiteProtection(prefs_, "example.com", kDetails, std::nullopt);
  EXPECT_EQ(SiteProtection(prefs_, "example.com", kDetails), std::nullopt);
  SetSiteProtection(prefs_, "example.com", kLinks, std::nullopt);
  // Nothing of its own left: not kept, so not listed.
  EXPECT_TRUE(prefs_.GetDict(kSiteProtectionsPref).empty());
  EXPECT_TRUE(SitesWithOwnPrivacy(prefs_).empty());
}

TEST_F(SitePrivacyTest, ListsASitesProtectionsBesideItsMode) {
  SetSiteProtection(prefs_, "example.com",
                    PageProtection::kRemoveTrackingFromLinks, false);
  SetSiteProtection(prefs_, "example.com", PageProtection::kHideDeviceDetails,
                    false);
  SetSiteAdBlocking(prefs_, "example.com", AdBlockingMode::kStrict);
  SetSiteProtection(prefs_, "zoom.us", PageProtection::kHideDeviceDetails,
                    false);
  const std::vector<std::pair<std::string, SitePrivacySettings>> sites =
      SitesWithOwnPrivacy(prefs_);
  ASSERT_EQ(sites.size(), 2u);
  EXPECT_EQ(sites[0].first, "example.com");
  EXPECT_EQ(sites[0].second.block_ads_and_trackers, AdBlockingMode::kStrict);
  // In kPageProtections order, not the order they were set in.
  const std::vector<std::pair<PageProtection, bool>> both = {
      {PageProtection::kHideDeviceDetails, false},
      {PageProtection::kRemoveTrackingFromLinks, false}};
  EXPECT_EQ(sites[0].second.protections, both);
  EXPECT_EQ(sites[1].first, "zoom.us");
  EXPECT_EQ(sites[1].second.block_ads_and_trackers, std::nullopt);
}

TEST_F(SitePrivacyTest, EachProtectionIsNamedAsTheConfigNamesIt) {
  for (const PageProtection protection : kPageProtections) {
    EXPECT_EQ(PageProtectionNamed(PageProtectionName(protection)), protection);
  }
  EXPECT_EQ(PageProtectionName(PageProtection::kHideDeviceDetails),
            "hide_device_details");
  EXPECT_EQ(PageProtectionNamed("block_third_party_cookies"), std::nullopt);
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
