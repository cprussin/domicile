// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/edid_name.h"

#include <cstddef>
#include <vector>

namespace ui {
namespace {

// Offsets of the four 18-byte descriptors in the 128-byte EDID base block.
constexpr size_t kDescriptorOffsets[] = {0x36, 0x48, 0x5A, 0x6C};
constexpr size_t kDescriptorLength = 18;

// Only a descriptor starting with three zero bytes has a tag. In a timing
// descriptor byte 3 is pixel data, so check the prefix before the tag.
constexpr size_t kTagIndex = 3;
constexpr uint8_t kSerialNumberTag = 0xFF;

// Descriptor text is 13 bytes, ended by a line feed and space padding. A
// 13-character serial has no terminator, so the length bounds the read.
constexpr size_t kTextIndex = 5;
constexpr size_t kTextLength = 13;
constexpr uint8_t kTerminator = 0x0A;

// The base block's little-endian 32-bit serial, used when no descriptor has
// one.
constexpr size_t kNumericSerialIndex = 0x0C;
constexpr size_t kNumericSerialLength = 4;

// The spec requires serials to be printable ASCII.
bool IsPrintableAscii(uint8_t byte) {
  return byte >= 0x20 && byte <= 0x7E;
}

// Strips spaces; monitors commonly pad descriptor strings.
std::string Trimmed(const std::string& part) {
  const size_t first = part.find_first_not_of(' ');
  if (first == std::string::npos) {
    return std::string();
  }
  return part.substr(first, part.find_last_not_of(' ') - first + 1);
}

// Formats the numeric serial as libdisplay-info does: `0x` and eight hex
// digits. Zero means unset and returns "".
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
  // Not `base::StringPrintf`, to stay free of Chromium types. Not a lookup
  // table, because `-Wunsafe-buffer-usage` rejects unbounded array indexing.
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
        // Reject the whole serial; a truncated one would match nothing.
        return std::string();
      }
      serial.push_back(static_cast<char>(byte));
    }

    // Many monitors pad with spaces instead of terminating.
    const size_t end = serial.find_last_not_of(' ');
    if (end != std::string::npos) {
      return serial.substr(0, end + 1);
    }
    // An all-padding descriptor falls back to the numeric serial.
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
