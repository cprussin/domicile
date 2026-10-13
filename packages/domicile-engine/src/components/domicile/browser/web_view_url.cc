// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_url.h"

#include <string_view>

#include "components/domicile/common/domicile_scheme.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/url_constants.h"

namespace domicile {

bool MayShowInWebView(const GURL& url, std::string_view app_host) {
  if (url.SchemeIs(url::kViewSourceScheme)) {
    return MayShowInWebView(GURL(url.GetContent()), app_host);
  }
  const url::Origin origin = url::Origin::Create(url);
  return origin.scheme() != kDomicileScheme ||
         (!app_host.empty() && origin.host() == app_host);
}

}  // namespace domicile
