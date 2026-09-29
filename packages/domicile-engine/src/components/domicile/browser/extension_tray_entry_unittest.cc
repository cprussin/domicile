// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/extension_tray_entry.h"

#include <cstdint>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkColor.h"

namespace domicile {
namespace {

TEST(ExtensionTrayEntryTest, ABadgeColorIsCssWithItsAlpha) {
  // #rrggbbaa, the CSS Color 4 hex form, so a shell can hand it straight to a
  // style. SkColor is ARGB, so the alpha moves from the front to the back.
  EXPECT_EQ(BadgeColorAsCss(SkColorSetARGB(0xFF, 0x1C, 0x3A, 0x2E)),
            "#1c3a2eff");
  EXPECT_EQ(BadgeColorAsCss(SkColorSetARGB(0x80, 0x00, 0x0A, 0xB0)),
            "#000ab080");
}

TEST(ExtensionTrayEntryTest, ABadgeWithNoColorIsTransparent) {
  // ExtensionAction answers an unset color with SkColor's zero, which is
  // transparent black -- a badge a shell then draws in its own color, rather
  // than a black one nobody chose.
  EXPECT_EQ(BadgeColorAsCss(SK_ColorTRANSPARENT), "#00000000");
}

TEST(ExtensionTrayEntryTest, AnIconIsAPngDataUrl) {
  const std::vector<uint8_t> png = {0x89, 'P', 'N', 'G'};
  EXPECT_EQ(PngAsDataUrl(png), "data:image/png;base64,iVBORw==");
}

}  // namespace
}  // namespace domicile
