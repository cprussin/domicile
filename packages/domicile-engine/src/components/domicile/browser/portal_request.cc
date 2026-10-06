// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_request.h"

#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/values.h"

namespace domicile {

std::optional<std::string> PortalAnswerLine(uint32_t id,
                                            std::string_view answer) {
  // A base::Value int is signed 32 bits; see SystemRequestLine.
  if (id > static_cast<uint32_t>(std::numeric_limits<int>::max())) {
    return std::nullopt;
  }
  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(answer, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->FindString("kind")) {
    return std::nullopt;
  }
  base::DictValue message;
  message.Set("type", "answer_portal_request");
  message.Set("id", static_cast<int>(id));
  message.Set("answer", std::move(*parsed));
  std::string line;
  CHECK(base::JSONWriter::Write(message, &line));
  return line;
}

}  // namespace domicile
