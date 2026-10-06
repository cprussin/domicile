// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_
#define COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_

#include <cstdint>
#include <string>

#include "base/containers/span.h"
#include "third_party/skia/include/core/SkColor.h"

namespace domicile {

// Formats extension action state for the shell page. The tray itself is
// //chrome/browser/domicile/domicile_extension_tray.cc; these helpers live
// here so tests need no profile.

// A badge's background as lowercase CSS `#rrggbbaa`. An unset color is
// transparent, so the shell picks its own color.
std::string BadgeColorAsCss(SkColor color);

// An encoded PNG as a `data:` URL. Icons set from `imageData` have no
// chrome-extension:// URL.
std::string PngAsDataUrl(base::span<const uint8_t> png);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_
