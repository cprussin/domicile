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

class AdBlockerTest : public testing::Test {
 protected:
  void Build(std::vector<std::string> lists, std::vector<std::string> rules) {
    blocker_ = AdBlocker::Build(lists, rules);
  }

  bool Blocks(const char* url,
              const char* page,
              bool strict = kStandard,
              const char* type = "script") {
    return blocker_->ShouldBlock(GURL(url), GURL(page), type, "GET", strict);
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
