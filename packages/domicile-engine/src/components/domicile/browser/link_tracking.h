// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_H_
#define COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_H_

#include <optional>

#include "url/gurl.h"

namespace domicile {

// `url` without the query parameters that only follow a click from site to
// site (`fbclid`, `gclid`, `msclkid` and the like, Brave's list) and, if
// `strict`, the campaign ones too (`utm_source` and the rest of `utm_`).
// Nothing when there are none, or `url` isn't http(s). The others keep their
// order and spelling. See docs/architecture/AD-BLOCKING.md.
std::optional<GURL> WithoutTracking(const GURL& url, bool strict);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_H_
