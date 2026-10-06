// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_pages.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

TEST(BrowserPagesTest, APageChromeServesItselfIsOne) {
  // chrome://history crashes in a guest: HistoryUI looks up its tab, and a
  // guest has none.
  EXPECT_TRUE(IsBrowserPage(GURL("chrome://history/")));
  EXPECT_TRUE(IsBrowserPage(GURL("chrome://settings/clearBrowserData")));
  EXPECT_TRUE(IsBrowserPage(GURL("chrome-untrusted://print/")));
}

TEST(BrowserPagesTest, ASiteIsNot) {
  EXPECT_FALSE(IsBrowserPage(GURL("https://example.com/")));
  EXPECT_FALSE(IsBrowserPage(GURL("about:blank")));
}

TEST(BrowserPagesTest, AnExtensionsPageIsNot) {
  // Covers tray popups and the PDF viewer. The viewer's chrome://resources
  // loads are subresources, so they are not checked.
  EXPECT_FALSE(IsBrowserPage(
      GURL("chrome-extension://mhjfbmdgcfjbbpaeojofohoemgfcjjof/index.html")));
}

TEST(BrowserPagesTest, TheShellIsNot) {
  EXPECT_FALSE(IsBrowserPage(GURL("domicile://shell/")));
}

}  // namespace
}  // namespace domicile
