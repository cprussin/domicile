// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/system_call.h"

#include <limits>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/values.h"

namespace domicile {
namespace {

// Why a call the last compositor had is over. See docs/SHELL-SYSTEM-ACCESS.md.
base::DictValue CompositorGone() {
  base::DictValue error;
  error.Set("kind", "compositor_gone");
  error.Set("message", "the compositor exited");
  base::DictValue failed;
  failed.Set("kind", "failed");
  failed.Set("error", std::move(error));
  return failed;
}

}  // namespace

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

bool IsSystemRequestLine(std::string_view line) {
  std::optional<base::DictValue> message =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  const std::string* type = message ? message->FindString("type") : nullptr;
  return type && *type == "system_request";
}

OpenCalls::OpenCalls() = default;

OpenCalls::~OpenCalls() = default;

void OpenCalls::Called(uint32_t id) {
  calls_.emplace(id, false);
}

void OpenCalls::Heard(const base::DictValue& message) {
  const std::string* type = message.FindString("type");
  if (!type || (*type != "system_reply" && *type != "system_end")) {
    return;
  }
  const std::optional<int> id = message.FindInt("id");
  if (!id || *id < 0) {
    return;
  }
  auto call = calls_.find(static_cast<uint32_t>(*id));
  if (call == calls_.end()) {
    return;
  }
  const base::DictValue* reply = message.FindDict("reply");
  const std::string* kind = reply ? reply->FindString("kind") : nullptr;
  if (*type == "system_reply" && kind && *kind == "started") {
    call->second = true;
  } else {
    calls_.erase(call);
  }
}

std::vector<std::string> OpenCalls::EndAll() {
  std::map<uint32_t, bool> calls;
  calls.swap(calls_);
  std::vector<std::string> lines;
  for (const auto& [id, started] : calls) {
    base::DictValue answer;
    answer.Set("id", static_cast<int>(id));
    if (started) {
      answer.Set("type", "system_end");
      answer.Set("end", CompositorGone());
    } else {
      answer.Set("type", "system_reply");
      answer.Set("reply", CompositorGone());
    }
    std::string line;
    CHECK(base::JSONWriter::Write(answer, &line));
    lines.push_back(std::move(line));
  }
  return lines;
}

}  // namespace domicile
