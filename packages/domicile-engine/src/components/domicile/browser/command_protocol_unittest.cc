// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/json/json_reader.h"
#include "base/values.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using ::testing::HasSubstr;

// What the engine was told to serve, and whether it was told at all.
//
// The second half is what most of these assert. A refused request must not
// have moved the shell -- a desktop that switched to a shell it then said it
// would not switch to is worse than either answer on its own.
struct Told {
  bool asked = false;
  base::FilePath root;
  std::string module;
};

// Answer one line against a recording engine. `has_window` false is an engine
// with no shell window to load a shell into, which is the one way applying a
// well-formed command can still fail.
std::string Answer(std::string_view line,
                   Told* told,
                   bool has_window = true) {
  auto load_shell = [told, has_window](const base::FilePath& root,
                                       const std::string& module) {
    told->asked = true;
    told->root = root;
    told->module = module;
    return has_window;
  };
  return AnswerCommand(line, load_shell);
}

// The reply's `type`, so a test asserts on the answer rather than on its
// spelling. Empty if the reply is not an object with one, which fails the
// assertion that reads it -- a reply this cannot read is a reply no supervisor
// could read either.
std::string TypeOf(const std::string& reply) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC);
  if (!parsed) {
    return "";
  }
  const std::string* type = parsed->FindString("type");
  return type ? *type : "";
}

// Why it was refused. Same contract as TypeOf.
std::string WhyOf(const std::string& reply) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC);
  if (!parsed) {
    return "";
  }
  const std::string* why = parsed->FindString("why");
  return why ? *why : "";
}

constexpr char kLoadOther[] =
    R"({"type":"load_shell","version":1,)"
    R"("root":"/home/someone/desktop/dist","module":"desktop.js"})";

TEST(CommandProtocolTest, LoadsTheShellARequestNames) {
  Told told;
  const std::string reply = Answer(kLoadOther, &told);

  EXPECT_EQ(TypeOf(reply), "loaded");
  EXPECT_TRUE(told.asked);
  EXPECT_EQ(told.root, base::FilePath("/home/someone/desktop/dist"));
  EXPECT_EQ(told.module, "desktop.js");
  // One line, and the newline is this side's to write: a caller wants the
  // bytes to put on the socket, not a string it has to remember to terminate.
  EXPECT_EQ(reply.find('\n'), reply.size() - 1);
}

TEST(CommandProtocolTest, RefusesALineThatIsNotARequest) {
  Told told;
  EXPECT_EQ(TypeOf(Answer("load_shell /home/someone/desktop", &told)),
            "refused");
  // Valid JSON, and still not a request. A list has no members to read.
  EXPECT_EQ(TypeOf(Answer("[1, 2, 3]", &told)), "refused");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAVersionItDoesNotSpeak) {
  // The reason this contract has a version at all: the supervisor and the
  // engine are separately published, so the two ends of this socket can be
  // built from different revisions. A supervisor that speaks a version this
  // engine does not is a skew, and the refusal is what turns it from a
  // desktop behaving strangely into a sentence naming both numbers.
  Told told;
  const std::string newer = Answer(
      R"({"type":"load_shell","version":2,"root":"/x","module":"shell.js"})",
      &told);
  EXPECT_EQ(TypeOf(newer), "refused");
  EXPECT_THAT(WhyOf(newer), HasSubstr("version"));

  // No version at all is the same refusal and not a separate leniency. A
  // request without one is from something that predates the contract, which
  // is exactly the skew the number exists to catch.
  EXPECT_EQ(
      TypeOf(Answer(R"({"type":"load_shell","root":"/x","module":"s.js"})",
                    &told)),
      "refused");

  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesACommandItDoesNotKnow) {
  Told told;
  const std::string reply =
      Answer(R"({"type":"reload_shell","version":1})", &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  // Named, because the supervisor that sent it is the thing to go and look at.
  EXPECT_THAT(WhyOf(reply), HasSubstr("reload_shell"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAShellThatIsMissingHalfOfItself) {
  // A shell is one module and the directory it is served out of, so neither
  // half is optional: a module resolved against the engine's current root is
  // the wrong tree, and a root with no module is a document with nothing in
  // it. ShellSource::Set takes the pair for the same reason.
  Told told;
  EXPECT_EQ(
      TypeOf(Answer(R"({"type":"load_shell","version":1,"module":"s.js"})",
                    &told)),
      "refused");
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"/x/dist"})",
                &told)),
            "refused");
  // Present and empty is the same absence wearing a field.
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"","module":"s.js"})",
                &told)),
            "refused");
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"/x","module":""})",
                &told)),
            "refused");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesARootThatIsNotAbsolute) {
  // The root is resolved in the engine's process, whose working directory the
  // sender does not know and should not have to. A relative root would serve
  // some other directory without saying so, which is the wrong desktop rather
  // than an error.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"dist","module":"s.js"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("absolute"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesWhenThereIsNoShellWindowToLoadInto) {
  // Setting the source without navigating anything would answer `loaded` for
  // a shell nobody can see, and the next reload -- of a window that does not
  // exist -- would be the first anyone heard of it.
  Told told;
  const std::string reply = Answer(kLoadOther, &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("window"));
}

TEST(CommandProtocolTest, IgnoresFieldsItDoesNotKnow) {
  // Within a version, an added field is not a breaking change -- so a newer
  // supervisor that still says version 1 must be understood rather than
  // refused, or the number would mean nothing and every addition would cost a
  // bump.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"/x/dist",)"
      R"("module":"shell.js","because":"the bundler rebuilt"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "loaded");
  EXPECT_EQ(told.module, "shell.js");
}

}  // namespace
}  // namespace domicile
