// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/system_call.h"

#include <optional>
#include <string>
#include <utility>

#include "base/json/json_reader.h"
#include "base/values.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// The line, parsed, so a test asserts on its fields rather than its spelling.
base::DictValue Parsed(const std::optional<std::string>& line) {
  EXPECT_TRUE(line.has_value());
  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line.value_or("{}"), base::JSON_PARSE_RFC);
  EXPECT_TRUE(parsed.has_value());
  return parsed ? std::move(*parsed) : base::DictValue();
}

TEST(SystemCallTest, ACallIsWrappedWithItsId) {
  base::DictValue line = Parsed(
      SystemRequestLine(7, R"({"call":"read_file","path":"/sys/x"})"));

  EXPECT_EQ(*line.FindString("type"), "system_request");
  EXPECT_EQ(line.FindInt("id"), 7);
  const base::DictValue* request = line.FindDict("request");
  ASSERT_TRUE(request);
  EXPECT_EQ(*request->FindString("call"), "read_file");
  EXPECT_EQ(*request->FindString("path"), "/sys/x");
}

// A page cannot send the compositor anything but a system request: a `type` it
// writes stays inside `request`, where the compositor does not read one.
TEST(SystemCallTest, APageCannotChooseTheMessage) {
  base::DictValue line = Parsed(SystemRequestLine(
      1, R"({"call":"stat","path":"/","type":"focus_app","app_id":"x"})"));

  EXPECT_EQ(*line.FindString("type"), "system_request");
  EXPECT_FALSE(line.FindString("app_id"));
}

TEST(SystemCallTest, ARequestThatIsNotACallIsRefused) {
  EXPECT_FALSE(SystemRequestLine(1, "not json"));
  EXPECT_FALSE(SystemRequestLine(1, R"(["call","stat"])"));
  EXPECT_FALSE(SystemRequestLine(1, R"({"path":"/"})"));
  EXPECT_FALSE(SystemRequestLine(1, R"({"call":3})"));
  EXPECT_FALSE(SystemRequestLine(0x80000000u, R"({"call":"stat"})"));
}

TEST(SystemCallTest, OnlyTheThreeAnswersAreRelayed) {
  EXPECT_TRUE(IsSystemAnswer("system_reply"));
  EXPECT_TRUE(IsSystemAnswer("system_event"));
  EXPECT_TRUE(IsSystemAnswer("system_end"));
  EXPECT_FALSE(IsSystemAnswer("system_request"));
  EXPECT_FALSE(IsSystemAnswer("battery"));
}

}  // namespace
}  // namespace domicile
