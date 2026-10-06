// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/line_framer.h"

#include <utility>

namespace domicile {

LineFramer::LineFramer() = default;
LineFramer::~LineFramer() = default;

std::vector<std::string> LineFramer::Take(std::string_view bytes) {
  std::vector<std::string> lines;
  // Search only `bytes`; `pending_` has no newline. Rescanning it would make
  // long lines quadratic.
  size_t newline = bytes.find('\n');
  while (newline != std::string_view::npos) {
    pending_.append(bytes.substr(0, newline));
    lines.push_back(std::exchange(pending_, std::string()));
    bytes.remove_prefix(newline + 1);
    newline = bytes.find('\n');
  }
  pending_.append(bytes);
  return lines;
}

}  // namespace domicile
