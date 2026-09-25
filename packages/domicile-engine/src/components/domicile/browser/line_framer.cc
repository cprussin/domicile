// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/line_framer.h"

#include <utility>

namespace domicile {

LineFramer::LineFramer() = default;
LineFramer::~LineFramer() = default;

std::vector<std::string> LineFramer::Take(std::string_view bytes) {
  std::vector<std::string> lines;
  // Only `bytes` is searched: `pending_` held no newline when it was kept, so
  // looking through it again would be the quadratic reader over again.
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
