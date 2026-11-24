// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/electron_page_call.h"

#include <string>
#include <string_view>
#include <utility>
#include <variant>

#include "base/check.h"
#include "base/strings/strcat.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/electron_protocol.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "url/gurl.h"

namespace domicile {
namespace {

// The page call on `line`, which must be one.
ElectronPageCall CallOn(std::string_view line) {
  base::expected<ElectronRequest, ElectronRefusal> request =
      ParseElectronRequest(line);
  CHECK(request.has_value()) << request.error().why;
  return std::get<ElectronPageCall>(std::move(*request));
}

// Why the page call on `line` is refused.
std::string RefusalOf(std::string_view line) {
  base::expected<ElectronRequest, ElectronRefusal> request =
      ParseElectronRequest(line);
  CHECK(!request.has_value());
  return request.error().why;
}

TEST(ElectronPageCallTest, EachMethodTakesWhatItNeeds) {
  EXPECT_EQ(
      CallOn(R"({"type":"page_call","window":2,"call":5,)"
             R"("method":"reload_ignoring_cache"})"),
      (ElectronPageCall{
          .window = 2, .call = 5, .method = ElectronReloadIgnoringCache{}}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"remove_inserted_css","key":"k","user":false})")
                .method,
            ElectronPageMethod(ElectronRemoveInsertedCss{.key = "k"}));
  EXPECT_EQ(
      CallOn(R"({"type":"page_call","window":1,"call":1,)"
             R"("method":"execute_in_isolated_world","world":999,)"
             R"("user_gesture":true,"scripts":[{"code":"1"},)"
             R"({"code":"2","url":"app://a/b.js"}]})")
          .method,
      ElectronPageMethod(ElectronExecuteInIsolatedWorld{
          .world = kElectronPreloadWorld,
          .scripts = {{.code = "1"}, {.code = "2", .url = "app://a/b.js"}},
          .user_gesture = true}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"copy_video_frame_at","x":3,"y":4})")
                .method,
            ElectronPageMethod(ElectronCopyVideoFrameAt{.x = 3, .y = 4}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"adjust_selection","start":-1,"end":2})")
                .method,
            ElectronPageMethod(ElectronAdjustSelection{.start = -1, .end = 2}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"set_webrtc_ip_policy",)"
                   R"("policy":"disable_non_proxied_udp"})")
                .method,
            ElectronPageMethod(ElectronSetWebRtcIpPolicy{
                .policy = ElectronWebRtcIpPolicy::kDisableNonProxiedUdp}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"set_ignore_input","ignore":true})")
                .method,
            ElectronPageMethod(ElectronSetIgnoreInput{.ignore = true}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"devtools",)"
                   R"("devtools_method":"Page.captureScreenshot",)"
                   R"("params":{"format":"png"}})")
                .method,
            ElectronPageMethod(ElectronDevToolsMethod{
                .method = "Page.captureScreenshot",
                .params = base::DictValue().Set("format", "png")}));
  // session.enableNetworkEmulation, in each of the session's pages.
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"devtools",)"
                   R"("devtools_method":"Network.emulateNetworkConditions",)"
                   R"("params":{"offline":true}})")
                .method,
            ElectronPageMethod(ElectronDevToolsMethod{
                .method = "Network.emulateNetworkConditions",
                .params = base::DictValue().Set("offline", true)}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"devtools","devtools_method":"Page.navigate",)"
                   R"("params":{"url":"https://a.test/"},"debugger":true,)"
                   R"("session_id":"S"})")
                .method,
            ElectronPageMethod(ElectronDevToolsMethod{
                .method = "Page.navigate",
                .params = base::DictValue().Set("url", "https://a.test/"),
                .debugger = true,
                .session_id = "S"}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"save_video_frame_at","x":3,"y":4})")
                .method,
            ElectronPageMethod(ElectronSaveVideoFrameAt{.x = 3, .y = 4}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"set_image_animation_policy",)"
                   R"("policy":"animate_once"})")
                .method,
            ElectronPageMethod(ElectronSetImageAnimationPolicy{
                .policy = ElectronImageAnimationPolicy::kAnimateOnce}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"set_webrtc_udp_port_range",)"
                   R"("min":0,"max":0})")
                .method,
            ElectronPageMethod(ElectronSetWebRtcUdpPortRange{}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"set_webrtc_udp_port_range",)"
                   R"("min":5000,"max":5010})")
                .method,
            ElectronPageMethod(
                ElectronSetWebRtcUdpPortRange{.min = 5000, .max = 5010}));
  EXPECT_EQ(CallOn(R"({"type":"page_call","window":1,"call":1,)"
                   R"("method":"debugger_attach"})")
                .method,
            ElectronPageMethod(ElectronAttachDebugger{}));
}

TEST(ElectronPageCallTest, AMethodMissingWhatItNeedsIsRefusedAsThatCall) {
  base::expected<ElectronRequest, ElectronRefusal> request =
      ParseElectronRequest(R"({"type":"page_call","window":2,"call":5,)"
                           R"("method":"insert_css","css":"a{}"})");

  ASSERT_FALSE(request.has_value());
  EXPECT_EQ(request.error(),
            (ElectronRefusal{.why = "\"user\" must be true or false",
                             .window = 2,
                             .page_call = 5}));
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":1,)"
                      R"("method":"execute_in_isolated_world","world":-1,)"
                      R"("user_gesture":false,"scripts":[{"code":"1"}]})"),
            "\"world\" must be from 0 to 1048576");
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":1,)"
                      R"("method":"execute_in_isolated_world","world":1,)"
                      R"("user_gesture":false,"scripts":[]})"),
            "\"scripts\" must be a list of scripts");
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":1,)"
                      R"("method":"set_webrtc_ip_policy","policy":"all"})"),
            "no WebRTC IP handling policy is named all");
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":1,)"
                      R"("method":"devtools",)"
                      R"("devtools_method":"Page.reload","params":{},)"
                      R"("session_id":1})"),
            "\"session_id\" must be a string");
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":1,)"
                      R"("method":"set_image_animation_policy",)"
                      R"("policy":"spin"})"),
            "no image animation policy is named spin");
  for (const std::string_view range :
       {R"("min":0,"max":5)", R"("min":9,"max":5)", R"("min":1,"max":65536)"}) {
    EXPECT_EQ(
        RefusalOf(base::StrCat(
            {R"({"type":"page_call","window":1,)", R"("call":1,"method":)",
             R"("set_webrtc_udp_port_range",)", range, "}"})),
        "\"min\" and \"max\" must be ports from 1 to 65535, the "
        "least first, or both 0")
        << range;
  }
  EXPECT_EQ(RefusalOf(R"({"type":"page_call","window":1,"call":0,)"
                      R"("method":"reload_ignoring_cache"})"),
            "\"call\" must be a whole number from 1");
}

TEST(ElectronPageCallTest, ResultsAndDevToolsEventsAreLines) {
  EXPECT_EQ(ElectronPageResult(2, 5, base::Value()),
            "{\"call\":5,\"result\":null,\"type\":\"page_result\","
            "\"window\":2}\n");
  EXPECT_EQ(ElectronPageResult(2, 6, base::unexpected("gone")),
            "{\"call\":6,\"error\":\"gone\",\"type\":\"page_result\","
            "\"window\":2}\n");
  EXPECT_EQ(ElectronDevToolsEvent(
                3, {.method = "Page.screencastFrame",
                    .params = base::DictValue().Set("sessionId", 1)}),
            "{\"method\":\"Page.screencastFrame\",\"params\":{\"sessionId\":1},"
            "\"type\":\"devtools_event\",\"window\":3}\n");
  EXPECT_EQ(ElectronDevToolsEvent(3, {.method = "Page.loadEventFired",
                                      .debugger = true,
                                      .session_id = "S"}),
            "{\"debugger\":true,\"method\":\"Page.loadEventFired\","
            "\"params\":{},\"session_id\":\"S\",\"type\":\"devtools_event\","
            "\"window\":3}\n");
  EXPECT_EQ(ElectronDebuggerDetached(3, "target closed"),
            "{\"reason\":\"target closed\",\"type\":\"debugger_detached\","
            "\"window\":3}\n");
}

TEST(ElectronPageCallTest, DevToolsFollowsAPageOnlyWhereAnAppMayTakeIt) {
  for (const std::string_view url :
       {"https://a.test/", "app://a/index.html", "file:///a.html",
        "about:blank", "view-source:https://a.test/"}) {
    EXPECT_TRUE(ElectronDevToolsMayAttachTo(GURL(url), false)) << url;
  }
  for (const std::string_view url :
       {"chrome://settings", "chrome-untrusted://a/", "devtools://devtools/",
        "domicile://shell/", "view-source:chrome://settings"}) {
    EXPECT_FALSE(ElectronDevToolsMayAttachTo(GURL(url), false)) << url;
  }
  EXPECT_FALSE(ElectronDevToolsMayAttachTo(GURL("https://a.test/"), true));
}

}  // namespace
}  // namespace domicile
