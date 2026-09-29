// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/extension_tray_entry.h"

#include "base/base64.h"
#include "base/strings/stringprintf.h"

namespace domicile {

std::string BadgeColorAsCss(SkColor color) {
  return base::StringPrintf("#%02x%02x%02x%02x", SkColorGetR(color),
                            SkColorGetG(color), SkColorGetB(color),
                            SkColorGetA(color));
}

std::string PngAsDataUrl(base::span<const uint8_t> png) {
  return "data:image/png;base64," + base::Base64Encode(png);
}

}  // namespace domicile
