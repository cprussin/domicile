// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/web_view_url.h"

#include "components/domicile/common/domicile_scheme.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/url_constants.h"

namespace domicile {

bool MayShowInWebView(const GURL& url) {
  return url.SchemeIs(url::kViewSourceScheme)
             ? MayShowInWebView(GURL(url.GetContent()))
             : url::Origin::Create(url).scheme() != kDomicileScheme;
}

}  // namespace domicile
