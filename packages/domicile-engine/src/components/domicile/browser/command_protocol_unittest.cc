// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <optional>
#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

using ::testing::HasSubstr;

// Records which actions a request triggered.
//
// Most tests assert that a refused request triggered none.
struct Told {
  bool asked = false;
  base::FilePath root;
  std::string module;
  bool opened = false;
  std::string url;
  bool captured = false;
  base::FilePath file;
};

// Answers one line with recording actions. `has_window` false makes every
// action fail, as when the engine has no shell window.
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
  auto open_url = [told, has_window](const GURL& url) {
    told->opened = true;
    told->url = url.spec();
    return has_window;
  };
  auto screenshot = [told, has_window](const base::FilePath& file,
                                       ScreenshotDone done) {
    told->captured = true;
    told->file = file;
    if (has_window) {
      std::move(done).Run(base::ok());
    } else {
      std::move(done).Run(base::unexpected("this engine has no shell page"));
    }
  };
  std::string reply;
  AnswerCommand(line, load_shell, open_url, screenshot,
                base::BindOnce([](std::string* out,
                                  std::string line) { *out = std::move(line); },
                               &reply));
  return reply;
}

// Returns the reply's `type`, or "" if the reply is not a JSON object with
// one.
std::string TypeOf(const std::string& reply) {
  const std::optional<base::DictValue> parsed =
      base::JSONReader::ReadDict(reply, base::JSON_PARSE_RFC);
  if (!parsed) {
    return "";
  }
  const std::string* type = parsed->FindString("type");
  return type ? *type : "";
}

// Returns the reply's `why`, or "" as for TypeOf.
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
  // The reply is one line and includes its newline.
  EXPECT_EQ(reply.find('\n'), reply.size() - 1);
}

TEST(CommandProtocolTest, RefusesALineThatIsNotARequest) {
  Told told;
  EXPECT_EQ(TypeOf(Answer("load_shell /home/someone/desktop", &told)),
            "refused");
  // Valid JSON that is not an object.
  EXPECT_EQ(TypeOf(Answer("[1, 2, 3]", &told)), "refused");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAVersionItDoesNotSpeak) {
  // The supervisor and engine ship separately, so a version mismatch must be
  // refused with a reason.
  Told told;
  const std::string newer = Answer(
      R"({"type":"load_shell","version":2,"root":"/x","module":"shell.js"})",
      &told);
  EXPECT_EQ(TypeOf(newer), "refused");
  EXPECT_THAT(WhyOf(newer), HasSubstr("version"));

  // A missing version is also a mismatch.
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
  // The reason names the command so the sender can be found.
  EXPECT_THAT(WhyOf(reply), HasSubstr("reload_shell"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAShellThatIsMissingHalfOfItself) {
  // A shell needs both its root and its module; neither has a usable default.
  Told told;
  EXPECT_EQ(
      TypeOf(Answer(R"({"type":"load_shell","version":1,"module":"s.js"})",
                    &told)),
      "refused");
  EXPECT_EQ(TypeOf(Answer(
                R"({"type":"load_shell","version":1,"root":"/x/dist"})",
                &told)),
            "refused");
  // An empty field counts as missing.
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
  // A relative root would resolve against the engine's working directory,
  // which the sender does not know.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"dist","module":"s.js"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("absolute"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesWhenThereIsNoShellWindowToLoadInto) {
  // Without a window, answering `loaded` would report a shell nobody can see.
  Told told;
  const std::string reply = Answer(kLoadOther, &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("window"));
}

TEST(CommandProtocolTest, IgnoresFieldsItDoesNotKnow) {
  // Adding a field does not bump the version, so unknown fields are ignored.
  Told told;
  const std::string reply = Answer(
      R"({"type":"load_shell","version":1,"root":"/x/dist",)"
      R"("module":"shell.js","because":"the bundler rebuilt"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "loaded");
  EXPECT_EQ(told.module, "shell.js");
}

TEST(CommandProtocolTest, HandsTheShellTheAddressARequestNames) {
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"https://example.com/a?b=c"})",
      &told);
  EXPECT_EQ(TypeOf(reply), "opened");
  EXPECT_TRUE(told.opened);
  EXPECT_EQ(told.url, "https://example.com/a?b=c");
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAnAddressThatIsNotAUrl) {
  // Otherwise the shell would open an empty window and report success.
  Told told;
  const std::string reply = Answer(
      R"({"type":"open_url","version":1,"url":"not a url"})", &told);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("not a url"));
  EXPECT_EQ(TypeOf(Answer(R"({"type":"open_url","version":1})", &told)),
            "refused");
  EXPECT_FALSE(told.opened);
}

TEST(CommandProtocolTest, RefusesWhenThereIsNoShellPageToOpenIn) {
  Told told;
  const std::string reply =
      Answer(R"({"type":"open_url","version":1,"url":"https://example.com/"})",
             &told, /*has_window=*/false);
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("shell page"));
}

constexpr char kScreenshot[] =
    R"({"type":"screenshot","version":1,"file":"/home/someone/shot.png"})";

TEST(CommandProtocolTest, WritesTheScreenshotToTheFileARequestNames) {
  Told told;
  EXPECT_EQ(TypeOf(Answer(kScreenshot, &told)), "captured");
  EXPECT_TRUE(told.captured);
  EXPECT_EQ(told.file, base::FilePath("/home/someone/shot.png"));
  EXPECT_FALSE(told.asked);
}

TEST(CommandProtocolTest, RefusesAScreenshotWithNoAbsoluteFile) {
  // A relative file would land in the engine's working directory, which the
  // sender does not know.
  Told told;
  const std::string relative =
      Answer(R"({"type":"screenshot","version":1,"file":"shot.png"})", &told);
  EXPECT_EQ(TypeOf(relative), "refused");
  EXPECT_THAT(WhyOf(relative), HasSubstr("absolute"));
  EXPECT_EQ(TypeOf(Answer(R"({"type":"screenshot","version":1})", &told)),
            "refused");
  EXPECT_FALSE(told.captured);
}

TEST(CommandProtocolTest, AnswersAScreenshotOnlyOnceItIsDone) {
  // The display compositor reads the desk back asynchronously, so the reply
  // waits for it and carries its failure.
  ScreenshotDone held;
  std::string reply;
  AnswerCommand(
      kScreenshot,
      [](const base::FilePath&, const std::string&) {
        ADD_FAILURE() << "a screenshot loads no shell";
        return false;
      },
      [](const GURL&) {
        ADD_FAILURE() << "a screenshot opens no address";
        return false;
      },
      [&held](const base::FilePath&, ScreenshotDone done) {
        held = std::move(done);
      },
      base::BindOnce(
          [](std::string* out, std::string line) { *out = std::move(line); },
          &reply));

  EXPECT_EQ(reply, "");
  std::move(held).Run(
      base::unexpected("could not write /home/someone/shot.png"));
  EXPECT_EQ(TypeOf(reply), "refused");
  EXPECT_THAT(WhyOf(reply), HasSubstr("could not write"));
}

}  // namespace
}  // namespace domicile
