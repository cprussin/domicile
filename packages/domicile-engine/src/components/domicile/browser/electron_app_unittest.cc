// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_app.h"

#include <map>
#include <optional>
#include <string>
#include <vector>

#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

constexpr char kHello[] =
    R"({"type":"hello","version":1,"app_id":"com.anthropic.Claude",)"
    R"("partition":"persist:electron-claude"})";

// A desk that numbers its windows from 10 and writes down each call.
class FakeDesk final : public ElectronDesk {
 public:
  std::optional<std::string> Open(const GURL& url,
                                  const ElectronHello& hello,
                                  const std::string& preload,
                                  ElectronPageCalls page_calls) override {
    if (!has_shell) {
      return std::nullopt;
    }
    calls.push_back("open " + url.spec() + " as " + hello.app_id +
                    (preload.empty() ? "" : " with " + preload));
    const std::string id = base::NumberToString(next_id++);
    pages.emplace(id, std::move(page_calls));
    return id;
  }
  void Load(const std::string& id, const GURL& url) override {
    calls.push_back("load " + id + " " + url.spec());
  }
  void Focus(const std::string& id) override { calls.push_back("focus " + id); }
  void AskToClose(const std::string& id) override {
    calls.push_back("ask to close " + id);
  }
  void Close(const std::string& id) override { calls.push_back("close " + id); }
  void SendToPage(const std::string& id,
                  const std::string& channel,
                  const std::string& args_json) override {
    calls.push_back("send " + id + " " + channel + " " + args_json);
  }

  bool has_shell = true;
  // What each window's page may call, by id.
  std::map<std::string, ElectronPageCalls> pages;
  int next_id = 10;
  std::vector<std::string> calls;
};

class ElectronAppTest : public testing::Test {
 protected:
  ElectronAppTest()
      : app_(std::in_place,
             desk_,
             base::BindRepeating(
                 [](std::vector<std::string>* sent, std::string line) {
                   sent->push_back(std::move(line));
                 },
                 &sent_)) {}

  // Says hello and forgets the reply.
  void Hello() {
    app_->Take(kHello);
    sent_.clear();
  }

  FakeDesk desk_;
  std::vector<std::string> sent_;
  std::optional<ElectronApp> app_;
};

using Lines = std::vector<std::string>;

TEST_F(ElectronAppTest, HelloIsAnsweredReady) {
  app_->Take(kHello);

  EXPECT_EQ(sent_, Lines{"{\"type\":\"ready\"}\n"});
}

TEST_F(ElectronAppTest, NothingOpensBeforeHello) {
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"refused\","
                         "\"why\":\"an app says hello first\"}\n"});
  EXPECT_TRUE(desk_.calls.empty());
}

TEST_F(ElectronAppTest, AppSaysHelloOnce) {
  Hello();

  app_->Take(kHello);

  EXPECT_EQ(sent_, Lines{"{\"type\":\"refused\","
                         "\"why\":\"this app already said hello\"}\n"});
}

TEST_F(ElectronAppTest, ABadLineIsRefusedAndTheAppKeepsGoing) {
  Hello();

  app_->Take("nonsense");
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");

  EXPECT_EQ(sent_, (Lines{"{\"type\":\"refused\","
                          "\"why\":\"a request must be a JSON object\"}\n",
                          "{\"type\":\"window_opened\",\"window\":1}\n"}));
}

TEST_F(ElectronAppTest, AWindowOpensAsAnAppWindowOfTheApp) {
  Hello();

  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");

  EXPECT_EQ(desk_.calls, Lines{"open https://a.test/ as com.anthropic.Claude"});
  EXPECT_EQ(sent_, Lines{"{\"type\":\"window_opened\",\"window\":1}\n"});
}

TEST_F(ElectronAppTest, AnUnsafeUrlIsRefusedAsItsWindows) {
  Hello();

  app_->Take(R"({"type":"open_window","window":2,"url":"chrome://x"})");

  EXPECT_EQ(sent_,
            Lines{"{\"type\":\"window_refused\",\"why\":\"chrome: "
                  "URLs do not open in an app window\",\"window\":2}\n"});
  EXPECT_TRUE(desk_.calls.empty());
}

TEST_F(ElectronAppTest, WithNoShellAWindowIsRefused) {
  Hello();
  desk_.has_shell = false;

  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"window_refused\",\"why\":\"there is "
                         "no shell to open it in\",\"window\":1}\n"});
}

TEST_F(ElectronAppTest, ANumberInUseIsRefused) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");
  sent_.clear();

  app_->Take(R"({"type":"open_window","window":1,"url":"https://b.test/"})");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"window_refused\",\"why\":\"window 1 "
                         "is already open\",\"window\":1}\n"});
}

TEST_F(ElectronAppTest, RequestsReachTheDesksWindow) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");
  desk_.calls.clear();

  app_->Take(R"({"type":"load_url","window":1,"url":"https://a.test/x"})");
  app_->Take(R"({"type":"focus_window","window":1})");
  app_->Take(R"({"type":"close_window","window":1})");
  app_->Take(R"({"type":"destroy_window","window":1})");

  EXPECT_EQ(desk_.calls, (Lines{"load 10 https://a.test/x", "focus 10",
                                "ask to close 10", "close 10"}));
}

TEST_F(ElectronAppTest, ARequestForAWindowNotOpenIsRefused) {
  Hello();

  app_->Take(R"({"type":"focus_window","window":4})");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"window_refused\",\"why\":\"window 4 "
                         "is not open\",\"window\":4}\n"});
  EXPECT_TRUE(desk_.calls.empty());
}

TEST_F(ElectronAppTest, TitlesAreReportedWhenTheyChange) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");
  sent_.clear();

  app_->Listed({{.id = "10", .title = "Claude"}, {.id = "3", .title = "x"}});
  app_->Listed({{.id = "10", .title = "Claude"}});

  EXPECT_EQ(sent_, Lines{"{\"title\":\"Claude\",\"type\":\"title_changed\","
                         "\"window\":1}\n"});
}

TEST_F(ElectronAppTest, AWindowGoneFromTheListIsClosed) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");
  sent_.clear();

  app_->Listed({});
  app_->Take(R"({"type":"focus_window","window":1})");

  EXPECT_EQ(sent_,
            (Lines{"{\"type\":\"window_closed\",\"window\":1}\n",
                   "{\"type\":\"window_refused\",\"why\":\"window 1 is not "
                   "open\",\"window\":1}\n"}));
}

TEST_F(ElectronAppTest, OnlyItsOwnWindowsLoadsAreReported) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  sent_.clear();

  app_->Loaded("10");
  app_->Loaded("11");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"window_loaded\",\"window\":2}\n"});
}

TEST_F(ElectronAppTest, AnAppThatGoesClosesItsWindows) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/"})");
  app_->Take(R"({"type":"open_window","window":2,"url":"https://b.test/"})");
  desk_.calls.clear();

  app_.reset();

  EXPECT_EQ(desk_.calls, (Lines{"close 10", "close 11"}));
}

TEST_F(ElectronAppTest, AWindowsPreloadReachesTheDesk) {
  Hello();

  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/",)"
             R"("preload":"window.x = 1"})");

  EXPECT_EQ(desk_.calls, Lines{"open https://a.test/ as com.anthropic.Claude "
                               "with window.x = 1"});
}

using Answer = std::optional<base::expected<base::Value, std::string>>;

// Writes an invoke's answer to `answer`.
ElectronAnswer Into(Answer& answer) {
  return base::BindOnce(
      [](Answer* answer, base::expected<base::Value, std::string> given) {
        *answer = std::move(given);
      },
      &answer);
}

base::ListValue OneAndA() {
  base::ListValue args;
  args.Append(1);
  args.Append("a");
  return args;
}

TEST_F(ElectronAppTest, APagesSendReachesTheApp) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  sent_.clear();

  desk_.pages.at("10").sent.Run("ping", OneAndA());

  EXPECT_EQ(sent_, Lines{R"({"args":[1,"a"],"channel":"ping",)"
                         R"("type":"ipc_message","window":2})"
                         "\n"});
}

TEST_F(ElectronAppTest, APagesInvokeIsAnsweredByTheAppsReply) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  sent_.clear();
  Answer first;
  Answer second;

  desk_.pages.at("10").invoked.Run("get", OneAndA(), Into(first));
  desk_.pages.at("10").invoked.Run("get", base::ListValue(), Into(second));
  app_->Take(R"({"type":"ipc_reply","invoke":2,"error":"no handler"})");
  app_->Take(R"({"type":"ipc_reply","invoke":1,"result":{"v":7}})");

  EXPECT_EQ(sent_, (Lines{R"({"args":[1,"a"],"channel":"get","invoke":1,)"
                          R"("type":"ipc_invoke","window":2})"
                          "\n",
                          R"({"args":[],"channel":"get","invoke":2,)"
                          R"("type":"ipc_invoke","window":2})"
                          "\n"}));
  ASSERT_TRUE(first.has_value() && first->has_value());
  EXPECT_EQ(base::WriteJson(**first), R"({"v":7})");
  ASSERT_TRUE(second.has_value());
  EXPECT_EQ(*second, base::unexpected("no handler"));
}

TEST_F(ElectronAppTest, AReplyNobodyWaitsOnIsRefused) {
  Hello();

  app_->Take(R"({"type":"ipc_reply","invoke":9,"result":1})");

  EXPECT_EQ(sent_, Lines{"{\"type\":\"refused\","
                         "\"why\":\"no invoke 9 is waiting\"}\n"});
}

TEST_F(ElectronAppTest, AnInvokeFromAClosedWindowFails) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  ElectronPageCalls page = desk_.pages.at("10");
  app_->Listed({});
  sent_.clear();
  Answer answer;

  page.invoked.Run("get", base::ListValue(), Into(answer));
  page.sent.Run("ping", base::ListValue());

  ASSERT_TRUE(answer.has_value());
  EXPECT_EQ(*answer, base::unexpected("the window is closed"));
  EXPECT_TRUE(sent_.empty());
}

TEST_F(ElectronAppTest, TheAppsSendReachesItsWindowsPage) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  desk_.calls.clear();

  app_->Take(R"({"type":"ipc_send","window":2,"channel":"ping",)"
             R"("args":[1,"a"]})");

  EXPECT_EQ(desk_.calls, Lines{R"(send 10 ping [1,"a"])"});
}

}  // namespace
}  // namespace domicile
