// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_
#define COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_

#include <cstdint>
#include <string>

#include "base/containers/span.h"
#include "third_party/skia/include/core/SkColor.h"

namespace domicile {

// How an action's state is spelled for the page, in the two places that is a
// decision rather than a copy. Carrying the tray out is //chrome/browser/
// domicile/domicile_extension_tray.cc, which is where an ExtensionAction is;
// these are here, where a test reaches them with no profile.

// A badge's background as CSS: `#rrggbbaa`, lower case. An unset color is
// SkColor's zero, which comes out fully transparent -- a badge the shell colors
// itself -- rather than as a black nobody chose.
std::string BadgeColorAsCss(SkColor color);

// An encoded PNG as a `data:` URL, which is what an icon crosses as: an icon an
// extension set from `imageData` has no chrome-extension:// URL to send.
std::string PngAsDataUrl(base::span<const uint8_t> png);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_EXTENSION_TRAY_ENTRY_H_
