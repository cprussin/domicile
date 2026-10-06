// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/portal_request.h"

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

TEST(PortalRequestTest, AnAnswerIsWrappedWithItsId) {
  base::DictValue line =
      Parsed(PortalAnswerLine(7, R"({"kind":"access","choices":[]})"));

  EXPECT_EQ(*line.FindString("type"), "answer_portal_request");
  EXPECT_EQ(line.FindInt("id"), 7);
  const base::DictValue* answer = line.FindDict("answer");
  ASSERT_TRUE(answer);
  EXPECT_EQ(*answer->FindString("kind"), "access");
  EXPECT_TRUE(answer->FindList("choices"));
}

// A `type` the page writes stays inside `answer`.
TEST(PortalRequestTest, APageCannotChooseTheMessage) {
  base::DictValue line = Parsed(PortalAnswerLine(
      1, R"({"kind":"refused","type":"focus_app","app_id":"x"})"));

  EXPECT_EQ(*line.FindString("type"), "answer_portal_request");
  EXPECT_FALSE(line.FindString("app_id"));
}

TEST(PortalRequestTest, AnAnswerWithoutAKindIsRefused) {
  EXPECT_FALSE(PortalAnswerLine(1, "not json"));
  EXPECT_FALSE(PortalAnswerLine(1, R"(["kind","access"])"));
  EXPECT_FALSE(PortalAnswerLine(1, R"({"no":"kind"})"));
  EXPECT_FALSE(PortalAnswerLine(1, R"({"kind":3})"));
  EXPECT_FALSE(PortalAnswerLine(0x80000000u, R"({"kind":"access"})"));
}

}  // namespace
}  // namespace domicile
