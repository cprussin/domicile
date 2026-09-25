// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/edid_name.h"

#include <cstddef>
#include <vector>

namespace ui {
namespace {

// The four 18-byte descriptors of an EDID's base block, at the offsets the
// spec fixes them at. A base block is 128 bytes; anything after it is an
// extension and carries no descriptor this reads.
constexpr size_t kDescriptorOffsets[] = {0x36, 0x48, 0x5A, 0x6C};
constexpr size_t kDescriptorLength = 18;

// A descriptor is a *display* descriptor -- the kind with a tag and a string
// in it -- only when it opens with three zero bytes. Anything else is a
// detailed TIMING descriptor, where those bytes are a pixel clock and byte 3
// is part of the horizontal active pixel count. Reading a tag out of one is
// how a resolution turns into a serial number, so the shape is checked before
// the tag is.
constexpr size_t kTagIndex = 3;
constexpr uint8_t kSerialNumberTag = 0xFF;

// The text of a display descriptor: 13 bytes after the five-byte preamble,
// terminated by a line feed where it is shorter than the block and padded out
// with spaces after that. A serial that is exactly 13 characters has no
// terminator at all, which is why the length is a bound rather than a search.
constexpr size_t kTextIndex = 5;
constexpr size_t kTextLength = 13;
constexpr uint8_t kTerminator = 0x0A;

// The base block's own 32-bit serial, little endian, which is what a monitor
// that carries no serial DESCRIPTOR often has instead. Plenty of panels fill
// in one and not the other.
constexpr size_t kNumericSerialIndex = 0x0C;
constexpr size_t kNumericSerialLength = 4;

// Whether `byte` is something a person can read off a sticker and type into a
// config file. A serial is printable ASCII by the spec, so anything else is a
// misread block or a broken EDID -- and either way it is not a name.
bool IsPrintableAscii(uint8_t byte) {
  return byte >= 0x20 && byte <= 0x7E;
}

// `part` without leading or trailing spaces. A monitor that pads its model
// descriptor is ordinary, and two of the three parts below come straight out
// of one.
std::string Trimmed(const std::string& part) {
  const size_t first = part.find_first_not_of(' ');
  if (first == std::string::npos) {
    return std::string();
  }
  return part.substr(first, part.find_last_not_of(' ') - first + 1);
}

// The base block's numeric serial, formatted the way libdisplay-info prints
// one and therefore the way it appears in a sway or kanshi config: eight hex
// digits behind an `0x`.
//
// Zero is not a serial. It is what the field holds when nobody filled it in,
// which is most monitors that carry a descriptor instead -- and naming every
// one of those `0x00000000` would make them all the same monitor, which is the
// collision this whole file exists to break.
std::string NumericSerialFromEdid(const std::vector<uint8_t>& edid) {
  if (edid.size() < kNumericSerialIndex + kNumericSerialLength) {
    return std::string();
  }
  uint32_t serial = 0;
  for (size_t i = 0; i < kNumericSerialLength; ++i) {
    serial |= static_cast<uint32_t>(edid[kNumericSerialIndex + i]) << (8 * i);
  }
  if (serial == 0) {
    return std::string();
  }
  // Hand-rolled rather than `base::StringPrintf`, for the reason the rest of
  // this file is: nothing here may reach for a Chromium type, or none of it
  // can be compiled outside a Chromium tree.
  //
  // Arithmetic rather than a lookup table, which is not style. Chromium
  // compiles with `-Wunsafe-buffer-usage`, where subscripting a C array by a
  // value the compiler cannot bound is an error -- and this series has already
  // lost one CI round to that warning on a file that had never been built
  // under it. A nibble has nowhere to go wrong.
  std::string out = "0x";
  for (int shift = 28; shift >= 0; shift -= 4) {
    const uint32_t nibble = (serial >> shift) & 0xF;
    out.push_back(static_cast<char>(nibble < 10 ? '0' + nibble
                                                : 'A' + (nibble - 10)));
  }
  return out;
}

}  // namespace

std::string SerialNumberFromEdid(const std::vector<uint8_t>& edid) {
  for (size_t offset : kDescriptorOffsets) {
    if (offset + kDescriptorLength > edid.size()) {
      continue;
    }
    const bool is_display_descriptor =
        edid[offset] == 0 && edid[offset + 1] == 0 && edid[offset + 2] == 0;
    if (!is_display_descriptor || edid[offset + kTagIndex] != kSerialNumberTag) {
      continue;
    }

    std::string serial;
    for (size_t i = 0; i < kTextLength; ++i) {
      const uint8_t byte = edid[offset + kTextIndex + i];
      if (byte == kTerminator) {
        break;
      }
      if (!IsPrintableAscii(byte)) {
        // The whole block rather than the part before it: a serial with a
        // control character in the middle is not a serial with a shorter
        // serial inside it, and half of one would be a name that looks
        // plausible and matches nothing.
        return std::string();
      }
      serial.push_back(static_cast<char>(byte));
    }

    // Trailing padding is not part of the number. Many monitors pad with
    // spaces instead of terminating, and a name with a space on the end is one
    // nobody can type.
    const size_t end = serial.find_last_not_of(' ');
    if (end != std::string::npos) {
      return serial.substr(0, end + 1);
    }
    // A descriptor that is all padding says nothing, so fall through to the
    // numeric field rather than returning the emptiness it states.
    break;
  }
  return NumericSerialFromEdid(edid);
}

bool IsPnpId(const std::string& make) {
  if (make.size() != 3) {
    return false;
  }
  for (const char letter : make) {
    if (letter < 'A' || letter > 'Z') {
      return false;
    }
  }
  return true;
}

std::string DisplayNameFrom(const std::string& make,
                            const std::string& model,
                            const std::string& serial) {
  std::string name;
  for (const std::string& part : {make, model, serial}) {
    const std::string trimmed = Trimmed(part);
    if (trimmed.empty()) {
      continue;
    }
    if (!name.empty()) {
      name.push_back(' ');
    }
    name.append(trimmed);
  }
  return name;
}

}  // namespace ui
