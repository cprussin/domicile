// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_pages.h"

#include "content/public/common/url_constants.h"
#include "url/gurl.h"

namespace domicile {

bool IsBrowserPage(const GURL& url) {
  return url.SchemeIs(content::kChromeUIScheme) ||
         url.SchemeIs(content::kChromeUIUntrustedScheme);
}

}  // namespace domicile
