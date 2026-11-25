// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/agent_input_lines.h"

#include <optional>
#include <string>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

std::string AgentLineWritten(const base::DictValue& message) {
  std::string line;
  EXPECT_TRUE(base::JSONWriter::Write(message, &line));
  return line;
}

std::optional<AgentPageInput> AgentLineRead(const std::string& line) {
  std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  EXPECT_TRUE(parsed) << line;
  return parsed ? ReadAgentInput(*parsed) : std::nullopt;
}

// The lines are packages/domicile-protocol/wire/host-messages.jsonl's.
TEST(AgentInputLinesTest, APointerIsReadAtItsDeskPoint) {
  const std::optional<AgentPageInput> read = AgentLineRead(
      R"({"type":"agent_input","serial":1764040000000001,"seat":"agent-3",)"
      R"("input":{"kind":"pointer","x":640.5,"y":400.0}})");
  ASSERT_TRUE(read);
  EXPECT_EQ(read->serial, 1764040000000001u);
  EXPECT_EQ(read->seat, "agent-3");
  EXPECT_EQ(read->kind, AgentPageInput::Kind::kPointer);
  EXPECT_EQ(read->at, gfx::PointF(640.5, 400));
  EXPECT_FALSE(read->quiet);
  EXPECT_TRUE(read->barred.empty());
}

TEST(AgentInputLinesTest, AButtonIsReadWithTheWindowsItMustNotReach) {
  const std::optional<AgentPageInput> read = AgentLineRead(
      R"({"type":"agent_input","serial":1764040000000002,"seat":"agent-3",)"
      R"("input":{"kind":"button","button":272,"pressed":true},)"
      R"("barred":["w2","w5"]})");
  ASSERT_TRUE(read);
  EXPECT_EQ(read->kind, AgentPageInput::Kind::kButton);
  EXPECT_EQ(read->code, 272u);
  EXPECT_TRUE(read->pressed);
  EXPECT_EQ(read->barred, (std::vector<std::string>{"w2", "w5"}));
}

TEST(AgentInputLinesTest, AScrollAKeyAndAFocusAreRead) {
  std::optional<AgentPageInput> read = AgentLineRead(
      R"({"type":"agent_input","serial":3,"seat":"agent-3",)"
      R"("input":{"kind":"scroll","dx":0.0,"dy":-15.0}})");
  ASSERT_TRUE(read);
  EXPECT_EQ(read->scroll, gfx::Vector2dF(0, -15));

  read = AgentLineRead(
      R"({"type":"agent_input","serial":4,"seat":"agent-3",)"
      R"("input":{"kind":"key","keycode":30,"pressed":false}})");
  ASSERT_TRUE(read);
  EXPECT_EQ(read->kind, AgentPageInput::Kind::kKey);
  EXPECT_EQ(read->code, 30u);
  EXPECT_FALSE(read->pressed);

  read = AgentLineRead(
      R"({"type":"agent_input","serial":5,"seat":"agent-3",)"
      R"("input":{"kind":"focus","window":"w7"}})");
  ASSERT_TRUE(read);
  EXPECT_EQ(read->window, "w7");
}

TEST(AgentInputLinesTest, TheRestAreQuiet) {
  for (const char* kind : {"leave", "blur", "let_go", "gone"}) {
    const std::optional<AgentPageInput> read = AgentLineRead(
        std::string(R"({"type":"agent_input","serial":6,"seat":"agent-3",)") +
        R"("input":{"kind":")" + kind + R"("},"quiet":true})");
    ASSERT_TRUE(read) << kind;
    EXPECT_TRUE(read->quiet) << kind;
  }
}

TEST(AgentInputLinesTest, WhatThisEngineCannotReadIsNothing) {
  EXPECT_FALSE(AgentLineRead(
      R"({"type":"agent_input","serial":1,"seat":"agent-3",)"
      R"("input":{"kind":"wiggle"}})"));
  EXPECT_FALSE(AgentLineRead(
      R"({"type":"agent_input","serial":1.5,"seat":"agent-3",)"
      R"("input":{"kind":"leave"}})"));
  EXPECT_FALSE(AgentLineRead(
      R"({"type":"agent_input","serial":1,"seat":"agent-3",)"
      R"("input":{"kind":"pointer","x":1}})"));
  EXPECT_FALSE(AgentLineRead(
      R"({"type":"agent_input","serial":1,"seat":"agent-3",)"
      R"("input":{"kind":"leave"},"barred":[3]})"));
}

// What the compositor's serde reads; its serial a double with a `.0`, which
// packages/domicile-protocol/tests/protocol.rs reads back whole.
TEST(AgentInputLinesTest, AnAnswerIsWrittenAsTheCompositorReadsIt) {
  EXPECT_EQ(AgentLineWritten(AgentInputReachedMessage(
                1764040000000001u, std::string("w7"), std::nullopt)),
            "{\"serial\":1.764040000000001e+15,"
            "\"type\":\"agent_input_reached\",\"window\":\"w7\"}");
  EXPECT_EQ(AgentLineWritten(AgentInputReachedMessage(
                7, std::nullopt, std::string("the shell"))),
            "{\"refused\":\"the shell\",\"serial\":7.0,"
            "\"type\":\"agent_input_reached\"}");
  EXPECT_EQ(AgentLineWritten(PersonInAgentsWindowMessage("agent-3", "w7", true)),
            "{\"keyboard\":true,\"seat\":\"agent-3\","
            "\"type\":\"person_in_agents_window\",\"window\":\"w7\"}");
}

}  // namespace
}  // namespace domicile
