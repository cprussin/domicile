// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_app.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/memory/raw_ref.h"
#include "base/memory/weak_ptr.h"
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
  std::optional<std::string> Open(
      const GURL& url,
      const std::string& app_id,
      const WebViewPartition& partition,
      const std::string& preload,
      ElectronPageCalls page_calls,
      base::WeakPtr<ElectronSession> session) override {
    if (!has_shell) {
      return std::nullopt;
    }
    calls.push_back("open " + url.spec() + " as " + app_id +
                    (preload.empty() ? "" : " with " + preload));
    const std::string id = base::NumberToString(next_id++);
    pages.emplace(id, std::move(page_calls));
    partitions.emplace(id, partition);
    sessions.emplace(id, std::move(session));
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
  void PostToPage(const std::string& id,
                  const std::string& channel,
                  const std::string& message_json,
                  const std::vector<std::string>& ports) override {
    std::string line = "post " + id + " " + channel + " " + message_json;
    for (const std::string& port : ports) {
      line += " " + port;
    }
    calls.push_back(line);
  }
  void PostToPort(const std::string& id,
                  const std::string& port,
                  const std::string& data_json) override {
    calls.push_back("port " + id + " " + port + " " + data_json);
  }
  void ClosePort(const std::string& id, const std::string& port) override {
    calls.push_back("close port " + id + " " + port);
  }
  void SetUserAgent(const std::string& id,
                    const std::string& user_agent) override {
    calls.push_back("user agent " + id + " " + user_agent);
  }
  void GetCookies(
      const WebViewPartition& partition,
      const std::optional<GURL>& url,
      base::OnceCallback<void(std::vector<ElectronCookie>)> done) override {
    calls.push_back("get cookies in " + partition.name +
                    (url.has_value() ? " for " + url->spec() : ""));
    std::move(done).Run(cookies);
  }
  void SetCookie(
      const WebViewPartition& partition,
      const ElectronCookieDetails& details,
      base::OnceCallback<void(std::optional<std::string>)> done) override {
    calls.push_back("set cookie " + details.name + " in " + partition.name);
    std::move(done).Run(cookie_refusal);
  }
  void RemoveCookie(const WebViewPartition& partition,
                    const GURL& url,
                    const std::string& name,
                    base::OnceClosure done) override {
    calls.push_back("remove cookie " + name + " for " + url.spec());
    std::move(done).Run();
  }
  void FlushCookies(const WebViewPartition& partition,
                    base::OnceClosure done) override {
    calls.push_back("flush cookies in " + partition.name);
    std::move(done).Run();
  }
  void ClearStorage(const WebViewPartition& partition,
                    const ElectronClearStorage& clear,
                    base::OnceClosure done) override {
    calls.push_back("clear storage in " + partition.name);
    waiting = std::move(done);
  }
  void ClearCache(const WebViewPartition& partition,
                  base::OnceClosure done) override {
    calls.push_back("clear cache in " + partition.name);
    std::move(done).Run();
  }

  bool has_shell = true;
  // What each window's page may call, by id.
  std::map<std::string, ElectronPageCalls> pages;
  // Each window's partition and session, by id.
  std::map<std::string, WebViewPartition> partitions;
  std::map<std::string, base::WeakPtr<ElectronSession>> sessions;
  int next_id = 10;
  std::vector<std::string> calls;
  // What GetCookies finds and why SetCookie fails, when it does.
  std::vector<ElectronCookie> cookies;
  std::optional<std::string> cookie_refusal;
  // A ClearStorage that has not finished.
  base::OnceClosure waiting;
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

  EXPECT_EQ(sent_, Lines{"{\"schemes\":[],\"type\":\"ready\"}\n"});
}

TEST_F(ElectronAppTest, ReadySaysWhichSchemesTheEngineRegistered) {
  app_.emplace(desk_,
               base::BindRepeating(
                   [](std::vector<std::string>* sent, std::string line) {
                     sent->push_back(std::move(line));
                   },
                   &sent_),
               std::vector<ElectronScheme>{{.scheme = "app", .secure = true}});

  app_->Take(kHello);

  EXPECT_EQ(sent_, Lines{"{\"schemes\":[{\"privileges\":[\"secure\"],"
                         "\"scheme\":\"app\"}],\"type\":\"ready\"}\n"});
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

TEST_F(ElectronAppTest, APagesSendSyncIsAnsweredByTheAppsReply) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  sent_.clear();
  Answer answer;

  desk_.pages.at("10").sent_sync.Run("get", OneAndA(), Into(answer));
  app_->Take(R"({"type":"ipc_reply","invoke":1,"result":"v"})");

  EXPECT_EQ(sent_, Lines{R"({"args":[1,"a"],"channel":"get","invoke":1,)"
                         R"("type":"ipc_send_sync","window":2})"
                         "\n"});
  ASSERT_TRUE(answer.has_value() && answer->has_value());
  EXPECT_EQ(base::WriteJson(**answer), R"("v")");
}

TEST_F(ElectronAppTest, APagesPortsReachTheApp) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  sent_.clear();
  const ElectronPageCalls& page = desk_.pages.at("10");

  page.posted.Run("port", base::Value("hi"), {"r1"});
  page.port_posted.Run("r1", base::Value(3));
  page.port_closed.Run("r1");
  page.gone.Run();

  EXPECT_EQ(sent_,
            (Lines{R"({"channel":"port","message":"hi","ports":["r1"],)"
                   R"("type":"ipc_post","window":2})"
                   "\n",
                   R"({"data":3,"port":"r1","type":"port_message","window":2})"
                   "\n",
                   R"({"port":"r1","type":"port_closed","window":2})"
                   "\n",
                   R"({"type":"page_gone","window":2})"
                   "\n"}));
}

TEST_F(ElectronAppTest, AClosedWindowsPortsSayNothing) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  ElectronPageCalls page = desk_.pages.at("10");
  app_->Listed({});
  sent_.clear();
  Answer answer;

  page.sent_sync.Run("get", base::ListValue(), Into(answer));
  page.posted.Run("port", base::Value(), {});
  page.port_posted.Run("r1", base::Value());
  page.port_closed.Run("r1");
  page.gone.Run();

  ASSERT_TRUE(answer.has_value());
  EXPECT_EQ(*answer, base::unexpected("the window is closed"));
  EXPECT_TRUE(sent_.empty());
}

TEST_F(ElectronAppTest, TheAppsPortsReachItsWindowsPage) {
  Hello();
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  desk_.calls.clear();
  sent_.clear();

  app_->Take(R"({"type":"ipc_post","window":2,"channel":"port",)"
             R"("message":{"a":1},"ports":["m1","m2"]})");
  app_->Take(R"({"type":"port_post","window":2,"port":"r1","data":[2]})");
  app_->Take(R"({"type":"port_close","window":2,"port":"m1"})");
  app_->Take(R"({"type":"port_close","window":3,"port":"m1"})");

  EXPECT_EQ(desk_.calls, (Lines{R"(post 10 port {"a":1} m1 m2)",
                                "port 10 r1 [2]", "close port 10 m1"}));
  EXPECT_EQ(sent_, Lines{R"({"type":"window_refused","why":"window 3 is not )"
                         R"(open","window":3})"
                         "\n"});
}

// A page's loader that writes down what the app answers.
class FakeResponder final : public ElectronResponder {
 public:
  explicit FakeResponder(std::vector<std::string>& log) : log_(log) {}
  ~FakeResponder() override { log_->push_back("gone"); }

  void Respond(ElectronResponse response) override {
    std::string line = "respond " + base::NumberToString(response.status);
    for (const auto& [name, value] : response.headers) {
      line += " " + name + "=" + value;
    }
    if (const auto* body = std::get_if<std::string>(&response.body)) {
      line += " body " + *body;
    } else if (const auto* file = std::get_if<base::FilePath>(&response.body)) {
      line += " file " + file->value();
    } else {
      line += " streamed";
    }
    log_->push_back(line);
  }
  void Fail(const std::string& why) override { log_->push_back("fail " + why); }
  void Data(std::string bytes) override { log_->push_back("data " + bytes); }
  void End(const std::optional<std::string>& error) override {
    log_->push_back(error.has_value() ? "end " + *error : "end");
  }

 private:
  const raw_ref<std::vector<std::string>> log_;
};

ElectronFetch Get(std::string_view url) {
  return ElectronFetch{.url = GURL(url),
                       .method = "GET",
                       .headers = {{"accept", "*/*"}},
                       .body = std::nullopt};
}

constexpr char kOpenOwn[] =
    R"({"type":"open_window","window":1,"url":"https://a.test/"})";

TEST_F(ElectronAppTest, AWindowOpensInItsSessionsPartition) {
  Hello();

  app_->Take(kOpenOwn);
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/",)"
             R"("session":"persist:cowork"})");

  EXPECT_EQ(desk_.partitions.at("10"),
            (WebViewPartition{.name = "electron-claude", .persist = true}));
  EXPECT_EQ(
      desk_.partitions.at("11"),
      (WebViewPartition{.name = "electron-claude:cowork", .persist = true}));
  ASSERT_TRUE(desk_.sessions.at("10") && desk_.sessions.at("11"));
  EXPECT_EQ(desk_.sessions.at("10")->name(), "");
  EXPECT_EQ(desk_.sessions.at("11")->name(), "persist:cowork");
}

TEST_F(ElectronAppTest, ASessionThatNamesNoPartitionRefusesItsWindow) {
  Hello();

  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/",)"
             R"("session":"persist:"})");

  EXPECT_EQ(sent_, Lines{R"({"type":"window_refused","why":"a partition of )"
                         R"(\"persist:\" names no partition to keep",)"
                         R"("window":2})"
                         "\n"});
  EXPECT_TRUE(desk_.calls.empty());
}

TEST_F(ElectronAppTest, AFileOpensOnceItsSessionHandlesFile) {
  Hello();

  app_->Take(R"({"type":"open_window","window":1,"url":"file:///opt/a.html"})");
  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"file"})");
  app_->Take(R"({"type":"open_window","window":2,"url":"file:///opt/a.html"})");
  app_->Take(R"({"type":"open_window","window":3,"url":"file:///opt/a.html",)"
             R"("session":"other"})");

  EXPECT_EQ(sent_,
            (Lines{R"({"type":"window_refused","why":"file: URLs open once )"
                   R"(the app handles file:","window":1})"
                   "\n",
                   "{\"type\":\"window_opened\",\"window\":2}\n",
                   R"({"type":"window_refused","why":"file: URLs open once )"
                   R"(the app handles file:","window":3})"
                   "\n"}));
  EXPECT_EQ(desk_.calls,
            Lines{"open file:///opt/a.html as com.anthropic.Claude"});
}

TEST_F(ElectronAppTest, ALoadIsCheckedAgainstItsWindowsSession) {
  Hello();
  app_->Take(kOpenOwn);
  sent_.clear();
  desk_.calls.clear();

  app_->Take(R"({"type":"load_url","window":1,"url":"app://localhost/"})");
  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"app"})");
  app_->Take(R"({"type":"load_url","window":1,"url":"app://localhost/"})");

  EXPECT_EQ(sent_, Lines{R"({"type":"window_refused","why":"app: URLs open )"
                         R"(once the app handles app:","window":1})"
                         "\n"});
  EXPECT_EQ(desk_.calls, Lines{"load 10 app://localhost/"});
}

TEST_F(ElectronAppTest, ASessionHandlesWhatTheAppHandlesThere) {
  Hello();
  app_->Take(kOpenOwn);
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/",)"
             R"("session":"other"})");

  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"https"})");
  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"file"})");
  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"app"})");
  app_->Take(R"({"type":"unhandle_protocol","session":"","scheme":"app"})");

  const ElectronSession& own = *desk_.sessions.at("10");
  const ElectronSession& other = *desk_.sessions.at("11");
  EXPECT_TRUE(own.Handles("https"));
  EXPECT_TRUE(own.Handles("file"));
  EXPECT_FALSE(own.Handles("app"));
  EXPECT_FALSE(own.Handles("http"));
  EXPECT_EQ(own.LocalSchemes(), std::vector<std::string>{"file"});
  EXPECT_FALSE(other.Handles("https"));
  EXPECT_TRUE(other.LocalSchemes().empty());
}

TEST_F(ElectronAppTest, AFetchIsAnsweredByTheAppsResponse) {
  Hello();
  app_->Take(kOpenOwn);
  app_->Take(R"({"type":"handle_protocol","session":"","scheme":"file"})");
  sent_.clear();
  std::vector<std::string> log;

  desk_.sessions.at("10")->Fetch(Get("file:///opt/a.html"),
                                 std::make_unique<FakeResponder>(log));
  app_->Take(R"({"type":"protocol_response","request":1,"status":200,)"
             R"("headers":[["content-type","text/html"]],"body":"aGk="})");

  EXPECT_EQ(sent_, Lines{R"({"headers":[["accept","*/*"]],"method":"GET",)"
                         R"("request":1,"session":"",)"
                         R"("type":"protocol_request",)"
                         R"("url":"file:///opt/a.html"})"
                         "\n"});
  EXPECT_EQ(log, (Lines{"respond 200 content-type=text/html body hi", "gone"}));
}

TEST_F(ElectronAppTest, AStreamedBodyComesInPiecesUntilItEnds) {
  Hello();
  app_->Take(kOpenOwn);
  std::vector<std::string> log;
  desk_.sessions.at("10")->Fetch(Get("file:///a"),
                                 std::make_unique<FakeResponder>(log));
  sent_.clear();

  app_->Take(R"({"type":"protocol_response","request":1,"status":206,)"
             R"("headers":[],"stream":true})");
  app_->Take(R"({"type":"protocol_data","request":1,"data":"aGk="})");
  app_->Take(R"({"type":"protocol_data","request":1,"data":"IQ=="})");
  app_->Take(R"({"type":"protocol_end","request":1})");
  app_->Take(R"({"type":"protocol_data","request":1,"data":"IQ=="})");

  EXPECT_EQ(
      log, (Lines{"respond 206 streamed", "data hi", "data !", "end", "gone"}));
  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"no protocol request 1 )"
                         R"(is waiting"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AFailedHandlerFailsTheRequest) {
  Hello();
  std::vector<std::string> log;
  app_->Take(kOpenOwn);
  desk_.sessions.at("10")->Fetch(Get("app://localhost/"),
                                 std::make_unique<FakeResponder>(log));

  app_->Take(
      R"({"type":"protocol_response","request":1,"error":"no such page"})");

  EXPECT_EQ(log, (Lines{"fail no such page", "gone"}));
}

TEST_F(ElectronAppTest, ABadResponseFailsItsRequestAndIsRefused) {
  Hello();
  std::vector<std::string> log;
  app_->Take(kOpenOwn);
  desk_.sessions.at("10")->Fetch(Get("app://localhost/"),
                                 std::make_unique<FakeResponder>(log));
  sent_.clear();

  app_->Take(R"({"type":"protocol_response","request":1,"status":99,)"
             R"("headers":[],"body":""})");

  EXPECT_EQ(log, (Lines{R"(fail "status" must be from 100 to 599)", "gone"}));
  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"\"status\" must be )"
                         R"(from 100 to 599"})"
                         "\n"});
}

TEST_F(ElectronAppTest, PiecesOfABodyNotStreamedAreRefused) {
  Hello();
  std::vector<std::string> log;
  app_->Take(kOpenOwn);
  desk_.sessions.at("10")->Fetch(Get("app://localhost/"),
                                 std::make_unique<FakeResponder>(log));
  sent_.clear();

  app_->Take(R"({"type":"protocol_data","request":1,"data":"aGk="})");

  EXPECT_EQ(log, (Lines{"fail the app sent a body's piece before a streamed "
                        "response",
                        "gone"}));
  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"the app sent a body's )"
                         R"(piece before a streamed response"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AnAppThatGoesDropsItsPagesRequests) {
  Hello();
  std::vector<std::string> log;
  app_->Take(kOpenOwn);
  base::WeakPtr<ElectronSession> session = desk_.sessions.at("10");
  session->Fetch(Get("app://localhost/"), std::make_unique<FakeResponder>(log));

  app_.reset();

  EXPECT_EQ(log, Lines{"gone"});
  EXPECT_FALSE(session);
}

ElectronWebRequestDetails Details(std::string_view url) {
  return ElectronWebRequestDetails{.id = 4,
                                   .url = GURL(url),
                                   .method = "GET",
                                   .resource_type = "mainFrame",
                                   .referrer = ""};
}

// Writes down the answer a waiting request got.
ElectronWebRequestAnswered Into(std::optional<ElectronWebRequestAnswer>& got) {
  return base::BindOnce(
      [](std::optional<ElectronWebRequestAnswer>* got,
         ElectronWebRequestAnswer answer) { *got = std::move(answer); },
      &got);
}

TEST_F(ElectronAppTest, ASessionListensForTheEventsTheAppNames) {
  Hello();
  app_->Take(kOpenOwn);
  const ElectronSession& own = *desk_.sessions.at("10");

  EXPECT_FALSE(own.ListensForWebRequests());
  app_->Take(R"({"type":"web_request_listen","session":"",)"
             R"("events":["before_request","completed"]})");
  EXPECT_TRUE(own.ListensForWebRequests());
  EXPECT_TRUE(own.ListensFor(ElectronWebRequestEvent::kBeforeRequest));
  EXPECT_TRUE(own.ListensFor(ElectronWebRequestEvent::kCompleted));
  EXPECT_FALSE(own.ListensFor(ElectronWebRequestEvent::kHeadersReceived));

  // Each line names them all.
  app_->Take(R"({"type":"web_request_listen","session":"",)"
             R"("events":["headers_received"]})");
  EXPECT_FALSE(own.ListensFor(ElectronWebRequestEvent::kBeforeRequest));
  EXPECT_TRUE(own.ListensFor(ElectronWebRequestEvent::kHeadersReceived));
}

TEST_F(ElectronAppTest, AWaitingRequestIsAnsweredByTheApp) {
  Hello();
  app_->Take(kOpenOwn);
  sent_.clear();
  std::optional<ElectronWebRequestAnswer> got;

  desk_.sessions.at("10")->AskWebRequest(
      ElectronWebRequestEvent::kBeforeRequest, "10", Details("https://a.test/"),
      Into(got));
  EXPECT_EQ(got, std::nullopt);
  app_->Take(R"({"type":"web_request_answer","ask":1,)"
             R"("redirect_url":"https://b.test/"})");

  EXPECT_EQ(sent_, Lines{R"({"ask":1,"event":"before_request","id":4,)"
                         R"("method":"GET","referrer":"",)"
                         R"("resource_type":"mainFrame","session":"",)"
                         R"("type":"web_request","url":"https://a.test/",)"
                         R"("window":1})"
                         "\n"});
  EXPECT_EQ(got, (ElectronWebRequestAnswer{
                     .ask = 1, .redirect_url = GURL("https://b.test/")}));
}

TEST_F(ElectronAppTest, ARequestNoWindowMadeNamesNone) {
  Hello();
  app_->Take(kOpenOwn);
  sent_.clear();

  desk_.sessions.at("10")->TellWebRequest(ElectronWebRequestEvent::kCompleted,
                                          std::nullopt,
                                          Details("https://a.test/"));

  EXPECT_EQ(sent_, Lines{R"({"event":"completed","id":4,"method":"GET",)"
                         R"("referrer":"","resource_type":"mainFrame",)"
                         R"("session":"","type":"web_request",)"
                         R"("url":"https://a.test/"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AnAnswerChangesOnlyWhatItsEventCan) {
  Hello();
  app_->Take(kOpenOwn);
  std::optional<ElectronWebRequestAnswer> got;
  desk_.sessions.at("10")->AskWebRequest(
      ElectronWebRequestEvent::kBeforeRequest, "10", Details("https://a.test/"),
      Into(got));
  sent_.clear();

  app_->Take(R"({"type":"web_request_answer","ask":1,)"
             R"("request_headers":[["a","1"]]})");

  // The app's bug fails the request rather than letting it through as if
  // the app had not asked for a change.
  EXPECT_EQ(got, (ElectronWebRequestAnswer{.ask = 1, .cancel = true}));
  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"an answer to )"
                         R"(before_request cannot set request_headers"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AnAnswerNobodyWaitsForIsRefused) {
  Hello();
  sent_.clear();

  app_->Take(R"({"type":"web_request_answer","ask":7})");

  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"no web request is )"
                         R"(waiting for answer 7"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AnAppThatGoesCancelsItsWaitingRequests) {
  Hello();
  app_->Take(kOpenOwn);
  std::optional<ElectronWebRequestAnswer> got;
  desk_.sessions.at("10")->AskWebRequest(
      ElectronWebRequestEvent::kHeadersReceived, "10",
      Details("https://a.test/"), Into(got));

  app_.reset();

  EXPECT_EQ(got, (ElectronWebRequestAnswer{.ask = 1, .cancel = true}));
}

// Writes down whether a permission request was granted.
base::OnceCallback<void(bool)> Into(std::optional<bool>& got) {
  return base::BindOnce(
      [](std::optional<bool>* got, bool granted) { *got = granted; }, &got);
}

TEST(ElectronPermissionForTest, NamesEachKindAsElectronDoes) {
  const GURL origin("https://a.test/");
  const auto name = [&](mojom::WebViewPermission permission) {
    const std::optional<ElectronPermissionDetails> details =
        ElectronPermissionFor({permission}, origin);
    return details.has_value() ? details->permission : "(shell)";
  };

  EXPECT_EQ(name(mojom::WebViewPermission::kLocation), "geolocation");
  EXPECT_EQ(name(mojom::WebViewPermission::kNotifications), "notifications");
  EXPECT_EQ(name(mojom::WebViewPermission::kClipboard), "clipboard-read");
  EXPECT_EQ(name(mojom::WebViewPermission::kMidi), "midiSysex");
  EXPECT_EQ(name(mojom::WebViewPermission::kWindowManagement),
            "window-management");
  EXPECT_EQ(name(mojom::WebViewPermission::kIdleDetection), "idle-detection");
  EXPECT_EQ(name(mojom::WebViewPermission::kLocalFonts), "unknown");
  // Electron never asks about downloads.
  EXPECT_EQ(name(mojom::WebViewPermission::kAutomaticDownloads), "(shell)");
}

TEST(ElectronPermissionForTest, CameraAndMicrophoneAreOneMediaRequest) {
  EXPECT_EQ(
      ElectronPermissionFor({mojom::WebViewPermission::kCamera,
                             mojom::WebViewPermission::kMicrophone},
                            GURL("https://a.test/")),
      (ElectronPermissionDetails{.permission = "media",
                                 .requesting_url = GURL("https://a.test/"),
                                 .media_types = {"video", "audio"}}));
  // Electron asks about each other kind on its own.
  EXPECT_EQ(ElectronPermissionFor({mojom::WebViewPermission::kCamera,
                                   mojom::WebViewPermission::kLocation},
                                  GURL("https://a.test/")),
            std::nullopt);
  EXPECT_EQ(ElectronPermissionFor({}, GURL("https://a.test/")), std::nullopt);
}

TEST_F(ElectronAppTest, ASessionHandlesPermissionsWhileTheAppSaysSo) {
  Hello();
  app_->Take(kOpenOwn);
  const ElectronSession& own = *desk_.sessions.at("10");

  EXPECT_FALSE(own.HandlesPermissions());
  app_->Take(R"({"type":"permission_handler","session":"","handle":true})");
  EXPECT_TRUE(own.HandlesPermissions());
  app_->Take(R"({"type":"permission_handler","session":"","handle":false})");
  EXPECT_FALSE(own.HandlesPermissions());
}

TEST_F(ElectronAppTest, APermissionRequestIsAnsweredByTheAppsHandler) {
  Hello();
  app_->Take(kOpenOwn);
  app_->Take(R"({"type":"permission_handler","session":"","handle":true})");
  sent_.clear();
  std::optional<bool> granted;
  std::optional<bool> denied;

  desk_.sessions.at("10")->AskPermission(
      "10",
      {.permission = "notifications",
       .requesting_url = GURL("https://a.test/")},
      Into(granted));
  desk_.sessions.at("10")->AskPermission(
      "10",
      {.permission = "geolocation", .requesting_url = GURL("https://a.test/")},
      Into(denied));
  EXPECT_EQ(granted, std::nullopt);
  app_->Take(R"({"type":"permission_answer","ask":2,"granted":false})");
  app_->Take(R"({"type":"permission_answer","ask":1,"granted":true})");

  EXPECT_EQ(sent_, (Lines{R"({"ask":1,"permission":"notifications",)"
                          R"("requesting_url":"https://a.test/","session":"",)"
                          R"("type":"permission_request","window":1})"
                          "\n",
                          R"({"ask":2,"permission":"geolocation",)"
                          R"("requesting_url":"https://a.test/","session":"",)"
                          R"("type":"permission_request","window":1})"
                          "\n"}));
  EXPECT_EQ(granted, true);
  EXPECT_EQ(denied, false);
}

TEST_F(ElectronAppTest, APermissionAnswerNobodyWaitsForIsRefused) {
  Hello();
  sent_.clear();

  app_->Take(R"({"type":"permission_answer","ask":5,"granted":true})");

  EXPECT_EQ(sent_, Lines{R"({"type":"refused","why":"no permission request )"
                         R"(is waiting for answer 5"})"
                         "\n"});
}

TEST_F(ElectronAppTest, AnAppThatGoesDeniesItsWaitingPermissions) {
  Hello();
  app_->Take(kOpenOwn);
  app_->Take(R"({"type":"permission_handler","session":"","handle":true})");
  std::optional<bool> got;
  desk_.sessions.at("10")->AskPermission(
      "10", {.permission = "media", .requesting_url = GURL("https://a.test/")},
      Into(got));

  app_.reset();

  EXPECT_EQ(got, false);
}

TEST_F(ElectronAppTest, ASessionCallGetsTheCookiesItsFilterMatches) {
  Hello();
  desk_.cookies = {{.name = "a", .value = "1", .domain = "a.test"},
                   {.name = "b", .value = "2", .domain = "b.test"}};

  app_->Take(R"({"type":"session_call","call":1,"session":"persist:work",)"
             R"("method":"cookies_get","filter":{"url":"https://a.test/",)"
             R"("domain":"a.test"}})");

  EXPECT_EQ(desk_.calls,
            Lines{"get cookies in electron-claude:work for https://a.test/"});
  EXPECT_EQ(sent_, Lines{"{\"call\":1,\"result\":[{\"domain\":\"a.test\","
                         "\"hostOnly\":false,\"httpOnly\":false,\"name\":\"a\","
                         "\"path\":\"\",\"sameSite\":\"unspecified\","
                         "\"secure\":false,\"session\":true,\"value\":\"1\"}],"
                         "\"type\":\"session_result\"}\n"});
}

TEST_F(ElectronAppTest, ASessionCallSaysWhyACookieWasNotSet) {
  Hello();
  desk_.cookie_refusal = "the cookie's domain is not the URL's";

  app_->Take(
      R"({"type":"session_call","call":2,"session":"","method":"cookies_set",)"
      R"("details":{"url":"https://a.test/","name":"n"}})");
  desk_.cookie_refusal.reset();
  app_->Take(
      R"({"type":"session_call","call":3,"session":"","method":"cookies_set",)"
      R"("details":{"url":"https://a.test/","name":"m"}})");

  EXPECT_EQ(desk_.calls, (Lines{"set cookie n in electron-claude",
                                "set cookie m in electron-claude"}));
  EXPECT_EQ(sent_, (Lines{"{\"call\":2,\"error\":\"the cookie's domain is not "
                          "the URL's\",\"type\":\"session_result\"}\n",
                          "{\"call\":3,\"result\":null,"
                          "\"type\":\"session_result\"}\n"}));
}

TEST_F(ElectronAppTest, ASessionCallIsAnsweredOnceTheDeskIsDone) {
  Hello();

  app_->Take(R"({"type":"session_call","call":4,"session":"",)"
             R"("method":"clear_storage_data"})");
  EXPECT_EQ(sent_, Lines{});
  std::move(desk_.waiting).Run();

  EXPECT_EQ(desk_.calls, Lines{"clear storage in electron-claude"});
  EXPECT_EQ(
      sent_,
      Lines{"{\"call\":4,\"result\":null,\"type\":\"session_result\"}\n"});
}

TEST_F(ElectronAppTest, AUserAgentReachesTheSessionsWindowsAndItsNewOnes) {
  Hello();
  app_->Take(R"({"type":"open_window","window":1,"url":"https://a.test/",)"
             R"("session":"persist:work"})");
  app_->Take(R"({"type":"open_window","window":2,"url":"https://a.test/"})");
  desk_.calls.clear();
  sent_.clear();

  app_->Take(R"({"type":"session_call","call":5,"session":"persist:work",)"
             R"("method":"set_user_agent","user_agent":"Claude/1"})");

  EXPECT_EQ(desk_.calls, Lines{"user agent 10 Claude/1"});
  EXPECT_EQ(
      sent_,
      Lines{"{\"call\":5,\"result\":null,\"type\":\"session_result\"}\n"});
  // A window opened later finds it on its session, before it loads.
  EXPECT_EQ(desk_.sessions.at("10")->user_agent(), "Claude/1");
  EXPECT_EQ(desk_.sessions.at("11")->user_agent(), "");
}

TEST_F(ElectronAppTest, ABadSessionCallIsAnsweredWithWhy) {
  Hello();

  app_->Take(R"({"type":"session_call","call":6,"session":"",)"
             R"("method":"cookies_remove"})");
  app_->Take(R"({"type":"session_call","call":7,"session":"persist:",)"
             R"("method":"clear_cache"})");

  EXPECT_EQ(desk_.calls, Lines{});
  EXPECT_EQ(
      sent_,
      (Lines{"{\"call\":6,\"error\":\"\\\"url\\\" must be a string\","
             "\"type\":\"session_result\"}\n",
             "{\"call\":7,\"error\":\"a partition of \\\"persist:\\\" "
             "names no partition to keep\",\"type\":\"session_result\"}\n"}));
}

}  // namespace
}  // namespace domicile
