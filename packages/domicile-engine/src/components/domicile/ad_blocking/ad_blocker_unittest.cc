// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/ad_blocker.h"

#include <memory>
#include <string>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using network::mojom::RequestDestination;

constexpr bool kStandard = false;
constexpr bool kStrict = true;
constexpr bool kCookieBannersShown = false;
constexpr bool kCookieBannersHidden = true;

class AdBlockerTest : public testing::Test {
 protected:
  void Build(std::vector<std::string> lists,
             std::vector<std::string> rules,
             std::vector<std::string> cookie_banner_lists = {}) {
    blocker_ = AdBlocker::Build(lists, rules, cookie_banner_lists);
  }

  bool Blocks(const char* url,
              const char* page,
              bool strict = kStandard,
              const char* type = "script",
              bool cookie_banners = kCookieBannersHidden) {
    return blocker_->ShouldBlock(GURL(url), GURL(page), type, "GET", strict,
                                 cookie_banners);
  }

  AdBlocker::Cosmetics CosmeticsFor(
      const char* page,
      bool cookie_banners = kCookieBannersHidden) {
    return blocker_->CosmeticsFor(GURL(page), cookie_banners);
  }

  std::unique_ptr<AdBlocker> blocker_;
};

TEST_F(AdBlockerTest, BlocksAnotherSitesRequestAListNames) {
  Build({"/ads/*\n"}, {});
  EXPECT_TRUE(Blocks("https://cdn.example/ads/a.js", "https://news.example/"));
  EXPECT_TRUE(Blocks("https://cdn.example/ads/a.js", "https://news.example/",
                     kStrict));
  EXPECT_FALSE(Blocks("https://cdn.example/app.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, StandardLetsASitesOwnRequestThroughAndStrictDoesNot) {
  Build({"/ads/*\n"}, {});
  // Another subdomain is the same site: Chromium's registry decides.
  EXPECT_FALSE(
      Blocks("https://static.news.example/ads/a.js", "https://www.news.example/"));
  EXPECT_TRUE(Blocks("https://static.news.example/ads/a.js",
                     "https://www.news.example/", kStrict));
  // A private registry counts too: two github.io sites are different sites.
  EXPECT_TRUE(
      Blocks("https://ads.github.io/ads/a.js", "https://news.github.io/"));
}

TEST_F(AdBlockerTest, AnImportantRuleBlocksASitesOwnRequestOnStandard) {
  Build({"/ads/*$important\n@@/ads/*\n"}, {});
  EXPECT_TRUE(Blocks("https://news.example/ads/a.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, AListsExceptionLetsARequestThrough) {
  Build({"/ads/*\n@@/ads/allowed.js\n"}, {});
  EXPECT_FALSE(
      Blocks("https://cdn.example/ads/allowed.js", "https://news.example/"));
  EXPECT_TRUE(Blocks("https://cdn.example/ads/a.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, YourOwnRulesBlockASitesOwnRequestOnStandard) {
  Build({}, {"/mine/*"});
  EXPECT_TRUE(Blocks("https://news.example/mine/a.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, YourOwnExceptionLiftsAListsRule) {
  Build({"||cdn.example^\n"}, {"@@||cdn.example^$script"});
  EXPECT_FALSE(Blocks("https://cdn.example/a.js", "https://news.example/"));
  EXPECT_TRUE(Blocks("https://cdn.example/a.png", "https://news.example/",
                     kStandard, "image"));
}

TEST_F(AdBlockerTest, ARuleForOneTypeLeavesTheOthers) {
  Build({"||pixel.example^$image\n"}, {});
  EXPECT_TRUE(Blocks("https://pixel.example/p", "https://news.example/",
                     kStandard, "image"));
  EXPECT_FALSE(Blocks("https://pixel.example/p", "https://news.example/"));
}

TEST_F(AdBlockerTest, ADomainOptionReadsThePage) {
  Build({"||widget.example^$domain=news.example\n"}, {});
  EXPECT_TRUE(Blocks("https://widget.example/w.js", "https://www.news.example/"));
  EXPECT_FALSE(Blocks("https://widget.example/w.js", "https://shop.example/"));
}

TEST_F(AdBlockerTest, SeveralListsAllApply) {
  Build({"||one.example^\n", "||two.example^\n"}, {});
  EXPECT_TRUE(Blocks("https://one.example/a.js", "https://news.example/"));
  EXPECT_TRUE(Blocks("https://two.example/a.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, NoListsAndNoRulesBlockNothing) {
  Build({}, {});
  EXPECT_FALSE(Blocks("https://cdn.example/ads/a.js", "https://news.example/",
                      kStrict));
}

TEST_F(AdBlockerTest, HidesWhatASitesRulesAndTheGenericOnesName) {
  Build({"example.com##.site-ad\n##div[data-ad]\nother.example##.theirs\n"},
        {"example.com##.mine\n"});
  const AdBlocker::Cosmetics cosmetics =
      CosmeticsFor("https://www.example.com/page");
  EXPECT_EQ(cosmetics.hide_selectors,
            (std::vector<std::string>{".mine", ".site-ad", "div[data-ad]"}));
  EXPECT_FALSE(cosmetics.generichide);
}

TEST_F(AdBlockerTest, HidesAPagesClassesAndIdsTheGenericRulesName) {
  Build({"##.ad-banner\n###sponsor\n##.other-ad\n"}, {"##.my-ad\n"});
  const AdBlocker::Cosmetics cosmetics = CosmeticsFor("https://news.example/");
  EXPECT_EQ(blocker_->HiddenClassIdSelectors({"ad-banner", "my-ad", "story"},
                                             {"sponsor"}, cosmetics.exceptions,
                                             kCookieBannersHidden),
            (std::vector<std::string>{"#sponsor", ".ad-banner", ".my-ad"}));
}

TEST_F(AdBlockerTest, ASitesExceptionKeepsAGenericRuleOffItsPages) {
  Build({"##.ad-banner\nexample.com#@#.ad-banner\n"}, {});
  const AdBlocker::Cosmetics cosmetics = CosmeticsFor("https://example.com/");
  EXPECT_EQ(cosmetics.exceptions, (std::vector<std::string>{".ad-banner"}));
  EXPECT_TRUE(blocker_
                  ->HiddenClassIdSelectors({"ad-banner"}, {},
                                           cosmetics.exceptions,
                                           kCookieBannersHidden)
                  .empty());
}

TEST_F(AdBlockerTest, AGenerichideExceptionLeavesOnlyTheSitesOwn) {
  Build({"##div[data-ad]\n@@||example.com^$generichide\n"
         "example.com##.site-ad\n"},
        {});
  const AdBlocker::Cosmetics cosmetics = CosmeticsFor("https://example.com/");
  EXPECT_TRUE(cosmetics.generichide);
  EXPECT_EQ(cosmetics.hide_selectors,
            (std::vector<std::string>{".site-ad"}));
}

TEST_F(AdBlockerTest, APageThatIsNotAWebsiteHidesNothing) {
  Build({"##div[data-ad]\n"}, {});
  EXPECT_TRUE(CosmeticsFor("domicile://shell/").hide_selectors.empty());
}

TEST_F(AdBlockerTest, TheCookieBannerListsBlockOnlyWhereBannersAreHidden) {
  Build({}, {}, {"||consent.example^\n"});
  EXPECT_TRUE(
      Blocks("https://consent.example/banner.js", "https://news.example/"));
  EXPECT_FALSE(Blocks("https://consent.example/banner.js",
                      "https://news.example/", kStandard, "script",
                      kCookieBannersShown));
}

TEST_F(AdBlockerTest, TheCookieBannerListsLetASitesOwnThroughAsTheListsDo) {
  Build({}, {}, {"/consent/*\n"});
  EXPECT_FALSE(Blocks("https://news.example/consent/banner.js",
                      "https://news.example/"));
  EXPECT_TRUE(Blocks("https://news.example/consent/banner.js",
                     "https://news.example/", kStrict));
}

TEST_F(AdBlockerTest, ACookieBannerListsExceptionIsItsOwn) {
  // The lists' exception does not lift the cookie list's rule, nor its the
  // lists'.
  Build({"||cdn.example^\n@@||cdn.example/consent.js\n"}, {},
        {"||cdn.example/consent.js\n@@||cdn.example/ads.js\n"});
  EXPECT_TRUE(
      Blocks("https://cdn.example/consent.js", "https://news.example/"));
  EXPECT_TRUE(Blocks("https://cdn.example/ads.js", "https://news.example/"));
  // Your own exception lifts both.
  Build({}, {"@@||cdn.example^"}, {"||cdn.example^\n"});
  EXPECT_FALSE(
      Blocks("https://cdn.example/consent.js", "https://news.example/"));
}

TEST_F(AdBlockerTest, HidesTheCookieBannerListsBannersOnlyWhereTheyAreHidden) {
  Build({"##.ad-banner\n"}, {},
        {"news.example###cookie-notice\n##.consent-popup\n##[data-consent]\n"});
  EXPECT_EQ(CosmeticsFor("https://news.example/").hide_selectors,
            (std::vector<std::string>{"#cookie-notice", "[data-consent]"}));
  EXPECT_TRUE(CosmeticsFor("https://news.example/", kCookieBannersShown)
                  .hide_selectors.empty());
  const AdBlocker::Cosmetics cosmetics = CosmeticsFor("https://news.example/");
  EXPECT_EQ(blocker_->HiddenClassIdSelectors({"ad-banner", "consent-popup"}, {},
                                             cosmetics.exceptions,
                                             kCookieBannersHidden),
            (std::vector<std::string>{".ad-banner", ".consent-popup"}));
  EXPECT_EQ(blocker_->HiddenClassIdSelectors({"ad-banner", "consent-popup"}, {},
                                             cosmetics.exceptions,
                                             kCookieBannersShown),
            (std::vector<std::string>{".ad-banner"}));
}

TEST(AdBlockRequestTypeTest, NamesWhatARequestFetchesAsFiltersDo) {
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kScript), "script");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kServiceWorker), "script");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kImage), "image");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kStyle), "stylesheet");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kIframe), "subdocument");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kVideo), "media");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kEmpty), "xmlhttprequest");
  EXPECT_EQ(AdBlockRequestType(RequestDestination::kManifest), "other");
}

}  // namespace
}  // namespace domicile
