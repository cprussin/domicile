// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/memory_stall.h"

#include <optional>
#include <string_view>

#include "base/strings/string_number_conversions.h"

namespace domicile {

std::optional<double> StalledPercent(std::string_view pressure) {
  constexpr std::string_view kPrefix = "some avg10=";
  if (!pressure.starts_with(kPrefix)) {
    return std::nullopt;
  }
  pressure.remove_prefix(kPrefix.size());
  double percent = 0;
  return base::StringToDouble(pressure.substr(0, pressure.find(' ')), &percent)
             ? std::optional(percent)
             : std::nullopt;
}

}  // namespace domicile
