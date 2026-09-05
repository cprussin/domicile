// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/spike/spike_color.h"

#include <algorithm>
#include <cstdint>

#include "base/command_line.h"
#include "base/logging.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"

namespace domicile::spike {
namespace {

int Distance(uint32_t x, uint32_t y) {
  return static_cast<int>(x > y ? x - y : y - x);
}

}  // namespace

bool ColorsMatch(SkColor a, SkColor b, int tolerance) {
  return ChannelDistance(a, b) <= tolerance;
}

int ChannelDistance(SkColor a, SkColor b) {
  return std::max({Distance(SkColorGetA(a), SkColorGetA(b)),
                   Distance(SkColorGetR(a), SkColorGetR(b)),
                   Distance(SkColorGetG(a), SkColorGetG(b)),
                   Distance(SkColorGetB(a), SkColorGetB(b))});
}

std::string ToHex(SkColor color) {
  return base::StringPrintf("#%08X", color);
}

SkColor ParseColor(const base::CommandLine& command_line,
                   const char* switch_name,
                   SkColor fallback) {
  if (!command_line.HasSwitch(switch_name)) {
    return fallback;
  }
  uint32_t value = 0;
  if (!base::HexStringToUInt(command_line.GetSwitchValueASCII(switch_name),
                             &value)) {
    LOG(ERROR) << "--" << switch_name << " wants AARRGGBB hex; using the "
               << "default";
    return fallback;
  }
  return value;
}

}  // namespace domicile::spike
