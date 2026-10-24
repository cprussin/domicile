// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/page_matches.h"

#include "base/json/string_escape.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"

namespace domicile {

std::u16string CountMatchesScript(std::string_view selector) {
  return base::UTF8ToUTF16(
      base::StrCat({"document.querySelectorAll(",
                    base::GetQuotedJSONString(selector), ").length"}));
}

std::optional<int32_t> CountFrom(const base::Value& result) {
  return result.is_int() ? std::make_optional(result.GetInt()) : std::nullopt;
}

}  // namespace domicile
