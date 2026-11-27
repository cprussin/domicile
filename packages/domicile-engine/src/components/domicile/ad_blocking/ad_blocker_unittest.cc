// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/ad_blocking/ad_blocker.h"

#include <memory>
#include <string>
#include <vector>

#include "base/base64.h"
#include "base/no_destructor.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using network::mojom::RequestDestination;

constexpr bool kStandard = false;
constexpr bool kStrict = true;
constexpr bool kCookieBannersShown = false;
constexpr bool kCookieBannersHidden = true;

using testing::HasSubstr;
using testing::Not;

AdBlocker::Scriptlet ScriptletOf(std::string name,
                                 std::string kind,
                                 const std::string& text,
                                 std::vector<std::string> dependencies = {}) {
  AdBlocker::Scriptlet scriptlet;
  scriptlet.name = std::move(name);
  scriptlet.kind = std::move(kind);
  scriptlet.content = base::Base64Encode(text);
  scriptlet.dependencies = std::move(dependencies);
  return scriptlet;
}

// A scriptlet as uBlock Origin's are, which needs another.
const std::vector<AdBlocker::Scriptlet>& Scriptlets() {
  static const base::NoDestructor<std::vector<AdBlocker::Scriptlet>> scriptlets(
      std::vector<AdBlocker::Scriptlet>{
          ScriptletOf("mark.js", "application/javascript",
                      "function mark(a) { helper(); window.marked = a; }",
                      {"helper.fn"}),
          ScriptletOf("helper.fn", "fn/javascript", "function helper() {}")});
  return *scriptlets;
}

class AdBlockerTest : public testing::Test {
 protected:
  void Build(std::vector<std::string> lists,
             std::vector<std::string> rules,
             std::vector<std::string> cookie_banner_lists = {}) {
    blocker_ =
        AdBlocker::Build(lists, rules, cookie_banner_lists, Scriptlets());
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

TEST_F(AdBlockerTest, RunsTheScriptletsASitesRulesName) {
  Build({"news.example##+js(mark, 1)\n"}, {"other.example##+js(mark, 2)"});
  const std::string script = CosmeticsFor("https://news.example/").script;
  EXPECT_THAT(script, HasSubstr("function helper() {}"));
  EXPECT_THAT(script, HasSubstr("function mark(a)"));
  EXPECT_THAT(script, HasSubstr(R"(mark("1"))"));
  EXPECT_THAT(CosmeticsFor("https://other.example/").script,
              HasSubstr(R"(mark("2"))"));
  EXPECT_EQ(CosmeticsFor("https://third.example/").script, "");
}

TEST_F(AdBlockerTest, AScriptletNoneHaveRunsNothing) {
  Build({"news.example##+js(missing, 1)\n"}, {});
  EXPECT_EQ(CosmeticsFor("https://news.example/").script, "");
}

TEST_F(AdBlockerTest, AScriptletExceptionKeepsItOffTheSite) {
  Build({"news.example,other.example##+js(mark, 1)\n"
         "news.example#@#+js(mark, 1)\n"},
        {});
  EXPECT_EQ(CosmeticsFor("https://news.example/").script, "");
  EXPECT_THAT(CosmeticsFor("https://other.example/").script,
              HasSubstr(R"(mark("1"))"));
}

TEST_F(AdBlockerTest,
       TheCookieBannerListsScriptletsRunOnlyWhereBannersAreHidden) {
  Build({}, {}, {"news.example##+js(mark, banner)\n"});
  EXPECT_THAT(CosmeticsFor("https://news.example/").script,
              HasSubstr(R"(mark("banner"))"));
  EXPECT_THAT(CosmeticsFor("https://news.example/", kCookieBannersShown).script,
              Not(HasSubstr("mark(")));
}

TEST(AdBlockerScriptletsTest, ReadsAResourcesFilesScriptlets) {
  const std::optional<std::vector<AdBlocker::Scriptlet>> scriptlets =
      AdBlocker::ScriptletsIn(R"([
        {"name": "set-constant.js", "aliases": ["set.js"],
         "kind": {"mime": "application/javascript"}, "content": "Zm4=",
         "dependencies": ["safe-self.fn"]},
        {"name": "safe-self.fn", "kind": {"mime": "fn/javascript"},
         "content": "Zm4="},
        {"name": "old.js", "kind": "template", "content": "Zm4="}
      ])");
  ASSERT_TRUE(scriptlets.has_value());
  ASSERT_EQ(scriptlets->size(), 3u);
  EXPECT_EQ((*scriptlets)[0].name, "set-constant.js");
  EXPECT_EQ((*scriptlets)[0].aliases, std::vector<std::string>{"set.js"});
  EXPECT_EQ((*scriptlets)[0].kind, "application/javascript");
  EXPECT_EQ((*scriptlets)[0].content, "Zm4=");
  EXPECT_EQ((*scriptlets)[0].dependencies,
            std::vector<std::string>{"safe-self.fn"});
  EXPECT_EQ((*scriptlets)[1].kind, "fn/javascript");
  EXPECT_EQ((*scriptlets)[2].kind, "application/javascript");
}

TEST(AdBlockerScriptletsTest, LeavesOutRedirectsAndThoseThatNeedAPermission) {
  const std::optional<std::vector<AdBlocker::Scriptlet>> scriptlets =
      AdBlocker::ScriptletsIn(R"([
        {"name": "1x1.gif", "kind": {"mime": "image/gif"}, "content": "Zm4="},
        {"name": "trusted-set.js", "kind": {"mime": "application/javascript"},
         "content": "Zm4=", "permission": 1},
        {"name": "set.js", "kind": {"mime": "application/javascript"},
         "content": "Zm4="}
      ])");
  ASSERT_TRUE(scriptlets.has_value());
  ASSERT_EQ(scriptlets->size(), 1u);
  EXPECT_EQ((*scriptlets)[0].name, "set.js");
}

TEST(AdBlockerScriptletsTest, RefusesAFileThatIsNotAResourcesFile) {
  for (const char* text :
       {"", "{}", "[1]", R"([{"name": "a.js"}])",
        R"([{"name": "a.js", "kind": {"mime": "application/javascript"},
             "content": "Zm4=", "dependencies": [1]}])",
        R"([{"name": "a.js", "kind": "image", "content": "Zm4="}])"}) {
    EXPECT_FALSE(AdBlocker::ScriptletsIn(text).has_value()) << text;
  }
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
