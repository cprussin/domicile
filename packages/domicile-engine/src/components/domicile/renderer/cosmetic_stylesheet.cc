// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/cosmetic_stylesheet.h"

#include "base/strings/string_split.h"
#include "base/strings/string_util.h"

namespace domicile {

std::string CosmeticStylesheetOf(const std::vector<std::string>& selectors) {
  std::string sheet;
  for (const std::string& selector : selectors) {
    if (selector.empty() || selector.find_first_of("{}") != std::string::npos) {
      continue;
    }
    sheet += selector;
    sheet += "{display:none !important}\n";
  }
  return sheet;
}

std::vector<std::string> ClassesOf(std::string_view attribute) {
  return base::SplitString(attribute, base::kWhitespaceASCII,
                           base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY);
}

}  // namespace domicile
