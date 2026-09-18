// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_

#include <cstdint>
#include <string>
#include <vector>

namespace ui {

// The panel's printed serial number, out of the raw EDID it came with.
//
// THE ONE THING THE PARSED EDID DOES NOT CARRY. display::EdidParser reads the
// same descriptor this does and keeps only
// `descriptor_block_serial_number_hash()` -- a hash, deliberately, because
// upstream treats a serial as an identifier to be kept out of metrics. That is
// the right default for a browser and the wrong one here: the serial is what
// tells three identical monitors apart, it is what kanshi and sway match a
// profile on, and it has to be a string a person can type into a config file
// for any of that to work. It is read off the user's own hardware, shown to
// the user, and goes nowhere else.
//
// Two places carry one, and monitors are inconsistent about which they fill
// in: the 0xFF display descriptor holds the printed string, and the base
// block's bytes 12-15 hold a 32-bit number. The descriptor wins where there is
// one, because it is what is on the sticker; the number is formatted the way
// libdisplay-info prints it -- `0x0001E368` -- which is the form already
// written down in a sway or kanshi config.
//
// Returns an empty string for a monitor that states neither, which is
// ordinary -- a projector, a virtual output, a panel whose maker left both
// out -- and for an EDID too short, malformed, or carrying something that is
// not printable ASCII where the serial should be.
//
// Deliberately free of Chromium types, so the one piece of this with an
// off-by-one in it can be compiled and tested on its own.
std::string SerialNumberFromEdid(const std::vector<uint8_t>& edid);

// Whether `make` is a three-letter PNP manufacturer id and not arithmetic that
// happened to produce characters.
//
// `display::EdidParser::ManufacturerIdToString` is five bits per letter with 1
// meaning 'A', and it validates nothing: a product code nobody set is zero,
// and zero decodes to "@@@" -- three characters one below 'A'. Chromium's own
// `kInvalidProductCode` decodes to punctuation. Both look enough like a name
// to end up in a config file, so the letters are checked rather than trusted.
bool IsPnpId(const std::string& make);

// The three parts as one name, with the missing ones left out.
//
// A monitor need not carry any of them -- a projector states no model, plenty
// of panels state no serial, a virtual output has no maker -- so the name is
// what is left, and a monitor with nothing to say gets an empty string rather
// than a string of separators. Single spaces, because that is what kanshi and
// sway put between them and this is meant to be the same string a person
// already has in a sway config.
std::string DisplayNameFrom(const std::string& make,
                            const std::string& model,
                            const std::string& serial);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_EDID_NAME_H_
