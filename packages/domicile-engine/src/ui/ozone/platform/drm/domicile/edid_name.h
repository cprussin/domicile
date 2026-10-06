// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_

#include <cstdint>
#include <string>
#include <vector>

namespace ui {

// Returns the monitor's serial number from its raw EDID, or "" if it has none
// or the EDID is malformed.
//
// `display::EdidParser` keeps only a hash of the serial. Here the serial
// tells identical monitors apart in configs, as in kanshi and sway.
//
// Prefers the 0xFF display descriptor (the printed string). Falls back to the
// base block's 32-bit number, formatted as libdisplay-info does
// (`0x0001E368`).
//
// Uses no Chromium types so it can be tested on its own.
std::string SerialNumberFromEdid(const std::vector<uint8_t>& edid);

// Whether `make` is a valid three-letter PNP manufacturer id.
//
// `display::EdidParser::ManufacturerIdToString` does not validate: an unset
// code decodes to "@@@" and `kInvalidProductCode` to punctuation.
bool IsPnpId(const std::string& make);

// Joins the non-empty parts with single spaces, matching kanshi and sway
// output names.
std::string DisplayNameFrom(const std::string& make,
                            const std::string& model,
                            const std::string& serial);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_
