// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_protocol.h"

#include <string>
#include <variant>

#include "base/json/json_writer.h"
#include "base/values.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

std::string WhyRefused(std::string_view line) {
  const auto request = ParseElectronRequest(line);
  EXPECT_FALSE(request.has_value()) << line;
  return request.has_value() ? "" : request.error().why;
}

TEST(ElectronProtocolTest, HelloNamesTheAppAndItsPartition) {
  const auto request = ParseElectronRequest(
      R"({"type":"hello","version":1,"app_id":"com.anthropic.Claude",)"
      R"("partition":"persist:electron-claude"})");

  ASSERT_TRUE(request.has_value()) << request.error().why;
  const auto* hello = std::get_if<ElectronHello>(&*request);
  ASSERT_NE(hello, nullptr);
  EXPECT_EQ(hello->app_id, "com.anthropic.Claude");
  EXPECT_EQ(hello->partition,
            (WebViewPartition{.name = "electron-claude", .persist = true}));
}

TEST(ElectronProtocolTest, HelloFromAnotherVersionIsRefusedWithOurs) {
  EXPECT_EQ(WhyRefused(R"({"type":"hello","version":2,"app_id":"a",)"
                       R"("partition":"persist:a"})"),
            "this engine speaks version 1");
}

TEST(ElectronProtocolTest, HelloNeedsAnAppId) {
  EXPECT_EQ(WhyRefused(R"({"type":"hello","version":1,"app_id":"",)"
                       R"("partition":"persist:a"})"),
            "\"app_id\" must be a string that is not empty");
}

TEST(ElectronProtocolTest, AnAppNeverSharesTheProfilesPartition) {
  // The profile's partition holds the person's own browsing.
  EXPECT_EQ(WhyRefused(R"({"type":"hello","version":1,"app_id":"a",)"
                       R"("partition":""})"),
            "an app cannot use the profile's own partition");
}

TEST(ElectronProtocolTest, OpenWindowCarriesTheHostsNumberAndUrl) {
  const auto request = ParseElectronRequest(
      R"({"type":"open_window","window":3,"url":"https://claude.ai/"})");

  ASSERT_TRUE(request.has_value()) << request.error().why;
  const auto* open = std::get_if<ElectronOpenWindow>(&*request);
  ASSERT_NE(open, nullptr);
  EXPECT_EQ(open->window, 3);
  EXPECT_EQ(open->url, GURL("https://claude.ai/"));
}

TEST(ElectronProtocolTest, AFileUrlIsRefused) {
  // Content loads no file: URL in a guest, so the window would stay blank.
  EXPECT_EQ(WhyRefused(R"({"type":"load_url","window":1,)"
                       R"("url":"file:///opt/app/index.html"})"),
            "file: URLs do not open in an app window");
}

TEST(ElectronProtocolTest, OtherSchemesDoNotOpenAndTheRefusalIsTheWindows) {
  const auto request = ParseElectronRequest(
      R"({"type":"open_window","window":2,"url":"chrome://settings"})");

  ASSERT_FALSE(request.has_value());
  EXPECT_EQ(request.error(),
            (ElectronRefusal{.why = "chrome: URLs do not open in an app window",
                             .window = 2}));
}

TEST(ElectronProtocolTest, AWindowNumberIsAWholeNumberFromOne) {
  constexpr char kWhy[] = "\"window\" must be a whole number from 1";
  EXPECT_EQ(WhyRefused(R"({"type":"focus_window","window":0})"), kWhy);
  EXPECT_EQ(WhyRefused(R"({"type":"focus_window","window":1.5})"), kWhy);
  EXPECT_EQ(WhyRefused(R"({"type":"focus_window"})"), kWhy);
}

TEST(ElectronProtocolTest, EachWindowRequestIsItsOwnKind) {
  const auto focus =
      ParseElectronRequest(R"({"type":"focus_window","window":2})");
  const auto close =
      ParseElectronRequest(R"({"type":"close_window","window":2})");
  const auto destroy =
      ParseElectronRequest(R"({"type":"destroy_window","window":2})");

  ASSERT_TRUE(focus.has_value() && close.has_value() && destroy.has_value());
  EXPECT_TRUE(std::holds_alternative<ElectronFocusWindow>(*focus));
  EXPECT_TRUE(std::holds_alternative<ElectronCloseWindow>(*close));
  EXPECT_TRUE(std::holds_alternative<ElectronDestroyWindow>(*destroy));
}

TEST(ElectronProtocolTest, AnUnknownRequestIsNamed) {
  EXPECT_EQ(WhyRefused(R"({"type":"fly"})"), "no request is named fly");
}

TEST(ElectronProtocolTest, ALineThatIsNotAnObjectIsRefused) {
  EXPECT_EQ(WhyRefused("[1]"), "a request must be a JSON object");
  EXPECT_EQ(WhyRefused("{}"), "a request must have a \"type\"");
}

TEST(ElectronProtocolTest, EventsAreOneLineEach) {
  EXPECT_EQ(ElectronReady(), "{\"type\":\"ready\"}\n");
  EXPECT_EQ(ElectronRefused("no"), "{\"type\":\"refused\",\"why\":\"no\"}\n");
  EXPECT_EQ(ElectronWindowOpened(1),
            "{\"type\":\"window_opened\",\"window\":1}\n");
  EXPECT_EQ(ElectronWindowRefused(2, "gone"),
            "{\"type\":\"window_refused\",\"why\":\"gone\",\"window\":2}\n");
  EXPECT_EQ(ElectronWindowLoaded(3),
            "{\"type\":\"window_loaded\",\"window\":3}\n");
  EXPECT_EQ(ElectronTitleChanged(4, "Claude"),
            "{\"title\":\"Claude\",\"type\":\"title_changed\",\"window\":4}\n");
  EXPECT_EQ(ElectronWindowClosed(5),
            "{\"type\":\"window_closed\",\"window\":5}\n");
}

TEST(ElectronProtocolTest, OpenWindowCarriesItsPreload) {
  const auto request = ParseElectronRequest(
      R"({"type":"open_window","window":1,"url":"https://a.test/",)"
      R"("preload":"window.x = 1"})");

  ASSERT_TRUE(request.has_value()) << request.error().why;
  EXPECT_EQ(std::get<ElectronOpenWindow>(*request).preload, "window.x = 1");
  EXPECT_EQ(WhyRefused(R"({"type":"open_window","window":1,)"
                       R"("url":"https://a.test/","preload":3})"),
            "\"preload\" must be a string");
}

TEST(ElectronProtocolTest, IpcSendCarriesItsChannelAndArguments) {
  const auto request = ParseElectronRequest(
      R"({"type":"ipc_send","window":2,"channel":"ping","args":[1,"a"]})");

  ASSERT_TRUE(request.has_value()) << request.error().why;
  const auto& send = std::get<ElectronSendToPage>(*request);
  EXPECT_EQ(send.window, 2);
  EXPECT_EQ(send.channel, "ping");
  EXPECT_EQ(base::WriteJson(send.args), R"([1,"a"])");

  const auto refused = ParseElectronRequest(
      R"({"type":"ipc_send","window":2,"channel":"ping"})");
  ASSERT_FALSE(refused.has_value());
  EXPECT_EQ(refused.error(),
            (ElectronRefusal{.why = "\"args\" must be an array", .window = 2}));
}

TEST(ElectronProtocolTest, IpcReplyCarriesAResultOrWhyItFailed) {
  const auto result = ParseElectronRequest(
      R"({"type":"ipc_reply","invoke":3,"result":{"ok":true}})");
  ASSERT_TRUE(result.has_value()) << result.error().why;
  const auto& reply = std::get<ElectronReply>(*result);
  EXPECT_EQ(reply.invoke, 3);
  ASSERT_TRUE(reply.answer.has_value());
  EXPECT_EQ(base::WriteJson(*reply.answer), R"({"ok":true})");

  const auto nothing =
      ParseElectronRequest(R"({"type":"ipc_reply","invoke":4})");
  ASSERT_TRUE(nothing.has_value()) << nothing.error().why;
  EXPECT_TRUE(std::get<ElectronReply>(*nothing).answer->is_none());

  const auto failed = ParseElectronRequest(
      R"({"type":"ipc_reply","invoke":5,"error":"no handler"})");
  ASSERT_TRUE(failed.has_value()) << failed.error().why;
  EXPECT_EQ(std::get<ElectronReply>(*failed).answer,
            base::unexpected("no handler"));
}

TEST(ElectronProtocolTest, IpcReplyIsOneOrTheOther) {
  EXPECT_EQ(WhyRefused(R"({"type":"ipc_reply","invoke":1,"result":1,)"
                       R"("error":"x"})"),
            "a reply has a \"result\" or an \"error\", not both");
  EXPECT_EQ(WhyRefused(R"({"type":"ipc_reply","invoke":0})"),
            "\"invoke\" must be a whole number from 1");
  EXPECT_EQ(WhyRefused(R"({"type":"ipc_reply","invoke":1,"error":2})"),
            "\"error\" must be a string");
}

TEST(ElectronProtocolTest, IpcEventsAreOneLineEach) {
  base::ListValue args;
  args.Append(1);
  args.Append("a");
  EXPECT_EQ(ElectronIpcMessage(1, "ping", args),
            R"({"args":[1,"a"],"channel":"ping","type":"ipc_message",)"
            R"("window":1})"
            "\n");
  EXPECT_EQ(ElectronIpcInvoke(2, 7, "get", args),
            R"({"args":[1,"a"],"channel":"get","invoke":7,)"
            R"("type":"ipc_invoke","window":2})"
            "\n");
}

}  // namespace
}  // namespace domicile
