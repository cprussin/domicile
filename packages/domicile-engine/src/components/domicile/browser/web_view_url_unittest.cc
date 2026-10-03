// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_url.h"

#include "components/domicile/common/domicile_scheme.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"
#include "url/url_util.h"

namespace domicile {
namespace {

// Registered the way every process of the engine registers it, for
// shell_url_loader_factory_unittest.cc's reason: unregistered, a domicile://
// address has an opaque origin, and the refusals below would pass for refusing
// an empty scheme rather than the one they name.
class WebViewUrlTest : public testing::Test {
 protected:
  WebViewUrlTest() {
    url::AddStandardScheme(kDomicileScheme, url::SCHEME_WITH_HOST);
  }

 private:
  url::ScopedSchemeRegistryForTests scheme_registry_;
};

TEST_F(WebViewUrlTest, AWebPageMayBeShown) {
  EXPECT_TRUE(MayShowInWebView(GURL("https://example.com/")));
  EXPECT_TRUE(MayShowInWebView(GURL("about:blank")));
}

TEST_F(WebViewUrlTest, NoDomicileAddressMayBeShown) {
  // A guest on domicile:// would hold the shell's origin, and the origin is
  // all the control channel's binder asks about.
  EXPECT_FALSE(MayShowInWebView(GURL("domicile://shell/")));
  EXPECT_FALSE(MayShowInWebView(GURL("domicile://home/Notes/a.png")));
  EXPECT_FALSE(MayShowInWebView(GURL("DOMICILE://shell/")));
}

TEST_F(WebViewUrlTest, NoAddressInsideADomicileOneMayBeShown) {
  // The shell can mint a blob, and a blob's document has its maker's origin.
  EXPECT_FALSE(MayShowInWebView(GURL("blob:domicile://shell/0f1e2d3c")));
  // view-source commits the source's own origin.
  EXPECT_FALSE(MayShowInWebView(GURL("view-source:domicile://shell/")));
  EXPECT_TRUE(MayShowInWebView(GURL("view-source:https://example.com/")));
}

}  // namespace
}  // namespace domicile
