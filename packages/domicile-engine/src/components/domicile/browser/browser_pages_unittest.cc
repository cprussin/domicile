// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_pages.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

TEST(BrowserPagesTest, APageChromeServesItselfIsOne) {
  // chrome://history is the one that took a desktop down: HistoryUI looks its
  // tab up unconditionally, and a <webview>'s guest is in no tab strip.
  EXPECT_TRUE(IsBrowserPage(GURL("chrome://history/")));
  EXPECT_TRUE(IsBrowserPage(GURL("chrome://settings/clearBrowserData")));
  EXPECT_TRUE(IsBrowserPage(GURL("chrome-untrusted://print/")));
}

TEST(BrowserPagesTest, ASiteIsNot) {
  EXPECT_FALSE(IsBrowserPage(GURL("https://example.com/")));
  EXPECT_FALSE(IsBrowserPage(GURL("about:blank")));
}

TEST(BrowserPagesTest, AnExtensionsPageIsNot) {
  // A tray's popup is one, and so is the PDF viewer -- which loads its own
  // pieces from chrome://resources, and keeps working because those are
  // subresources rather than a page in the window.
  EXPECT_FALSE(IsBrowserPage(
      GURL("chrome-extension://mhjfbmdgcfjbbpaeojofohoemgfcjjof/index.html")));
}

TEST(BrowserPagesTest, TheShellIsNot) {
  EXPECT_FALSE(IsBrowserPage(GURL("domicile://shell/")));
}

}  // namespace
}  // namespace domicile
