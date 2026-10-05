// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/system_call.h"

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

std::optional<std::string> SystemRequestLine(uint32_t id,
                                             std::string_view request) {
  // A base::Value int is signed 32 bits, and a double would be written as
  // `7.0`, which the compositor's `u32` refuses.
  if (id > static_cast<uint32_t>(std::numeric_limits<int>::max())) {
    return std::nullopt;
  }
  std::optional<base::DictValue> call =
      base::JSONReader::ReadDict(request, base::JSON_PARSE_RFC);
  if (!call || !call->FindString("call")) {
    return std::nullopt;
  }
  base::DictValue message;
  message.Set("type", "system_request");
  message.Set("id", static_cast<int>(id));
  message.Set("request", std::move(*call));
  std::string line;
  CHECK(base::JSONWriter::Write(message, &line));
  return line;
}

bool IsSystemAnswer(std::string_view type) {
  return type == "system_reply" || type == "system_event" ||
         type == "system_end";
}

}  // namespace domicile
