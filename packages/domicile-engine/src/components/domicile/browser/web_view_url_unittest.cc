// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_url.h"

#include "components/domicile/common/domicile_scheme.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/url_util.h"

namespace domicile {
namespace {

// Registers the scheme as the engine does. Unregistered, a domicile:// URL has
// an opaque origin and the refusals below would pass for the wrong reason.
// What a guest that no app was opened in is pinned to.
constexpr char kNoApp[] = "";

constexpr char kNotes[] = "app-3f34b27d8967e876d882c16c62df92be";

class WebViewUrlTest : public testing::Test {
 protected:
  WebViewUrlTest() {
    url::AddStandardScheme(kDomicileScheme, url::SCHEME_WITH_HOST);
  }

 private:
  url::ScopedSchemeRegistryForTests scheme_registry_;
};

TEST_F(WebViewUrlTest, AWebPageMayBeShown) {
  EXPECT_TRUE(MayShowInWebView(GURL("https://example.com/"), kNoApp));
  EXPECT_TRUE(MayShowInWebView(GURL("about:blank"), kNoApp));
}

TEST_F(WebViewUrlTest, NoDomicileAddressMayBeShown) {
  // A guest there would have the shell's origin, which is all the control
  // channel's binder checks.
  EXPECT_FALSE(MayShowInWebView(GURL("domicile://shell/"), kNoApp));
  EXPECT_FALSE(MayShowInWebView(GURL("domicile://home/Notes/a.png"), kNoApp));
  EXPECT_FALSE(MayShowInWebView(GURL("DOMICILE://shell/"), kNoApp));
}

TEST_F(WebViewUrlTest, NoAddressInsideADomicileOneMayBeShown) {
  // A blob has its creator's origin, and the shell can create blobs.
  EXPECT_FALSE(MayShowInWebView(GURL("blob:domicile://shell/0f1e2d3c"), kNoApp));
  // view-source commits the source's own origin.
  EXPECT_FALSE(MayShowInWebView(GURL("view-source:domicile://shell/"), kNoApp));
  EXPECT_TRUE(MayShowInWebView(GURL("view-source:https://example.com/"), kNoApp));
}

TEST_F(WebViewUrlTest, AnAppsWindowMayShowItsApp) {
  // `run_app` pins the window it opens to the app. See
  // docs/architecture/APP-MODULES.md.
  EXPECT_TRUE(MayShowInWebView(
      GURL("domicile://app-3f34b27d8967e876d882c16c62df92be/"), kNotes));
  EXPECT_TRUE(MayShowInWebView(GURL("https://example.com/"), kNotes));
}

TEST_F(WebViewUrlTest, NoOtherWindowMayShowAnApp) {
  // An app's host follows from its path, so a page that guessed one could
  // otherwise open any directory as an app.
  EXPECT_FALSE(MayShowInWebView(
      GURL("domicile://app-3f34b27d8967e876d882c16c62df92be/"), kNoApp));
  EXPECT_FALSE(MayShowInWebView(
      GURL("domicile://app-00000000000000000000000000000000/"), kNotes));
  EXPECT_FALSE(MayShowInWebView(GURL("domicile://shell/"), kNotes));
}

}  // namespace
}  // namespace domicile
