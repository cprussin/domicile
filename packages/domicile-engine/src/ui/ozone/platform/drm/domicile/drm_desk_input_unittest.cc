// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_desk_input.h"

#include <string>
#include <vector>

#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/ozone/public/system_input_injector.h"

namespace ui {
namespace {

// Writes down each call, as one line.
class RecordingInjector : public SystemInputInjector {
 public:
  void SetDeviceId(int device_id) override {}
  void MoveCursorTo(const gfx::PointF& location) override {
    calls.push_back("move " + location.ToString());
  }
  void InjectMouseButton(EventFlags button, bool down) override {
    calls.push_back(base::StrCat(
        {"button ", base::NumberToString(button), down ? " down" : " up"}));
  }
  void InjectMouseWheel(int delta_x, int delta_y) override {
    calls.push_back(base::StrCat({"wheel ", base::NumberToString(delta_x), ",",
                                  base::NumberToString(delta_y)}));
  }
  void InjectKeyEvent(DomCode physical_key,
                      bool down,
                      bool suppress_auto_repeat) override {
    calls.push_back(base::StrCat(
        {"key ", KeycodeConverter::DomCodeToCodeString(physical_key),
         down ? " down" : " up", suppress_auto_repeat ? "" : " repeating"}));
  }

  std::vector<std::string> calls;
};

using Kind = DomicileDeskInput::Kind;

TEST(DrmDeskInputTest, APointerMovesTheCursorToItsDeskPixel) {
  RecordingInjector injector;
  InjectDeskInput(injector, {.kind = Kind::kPointer, .x = 2100.5, .y = 40});

  EXPECT_EQ(injector.calls, std::vector<std::string>{"move 2100.5,40"});
}

TEST(DrmDeskInputTest, AButtonIsTheMouseButtonOfItsEvdevCode) {
  RecordingInjector injector;
  InjectDeskInput(injector,
                  {.kind = Kind::kButton, .code = 0x110, .pressed = true});
  InjectDeskInput(injector,
                  {.kind = Kind::kButton, .code = 0x111, .pressed = false});

  EXPECT_EQ(
      injector.calls,
      (std::vector<std::string>{
          "button " + base::NumberToString(EF_LEFT_MOUSE_BUTTON) + " down",
          "button " + base::NumberToString(EF_RIGHT_MOUSE_BUTTON) + " up"}));
}

TEST(DrmDeskInputTest, AButtonNoMouseHasIsDropped) {
  RecordingInjector injector;
  InjectDeskInput(injector,
                  {.kind = Kind::kButton, .code = 0x14a, .pressed = true});

  EXPECT_TRUE(injector.calls.empty());
}

TEST(DrmDeskInputTest, FifteenPixelsDownIsOneDetentDown) {
  RecordingInjector injector;
  InjectDeskInput(injector, {.kind = Kind::kScroll, .x = 0, .y = 15});

  EXPECT_EQ(injector.calls, std::vector<std::string>{"wheel 0,-120"});
}

TEST(DrmDeskInputTest, AKeyIsItsEvdevKeyAndNeverRepeats) {
  RecordingInjector injector;
  InjectDeskInput(injector, {.kind = Kind::kKey, .code = 30, .pressed = true});

  EXPECT_EQ(injector.calls, std::vector<std::string>{"key KeyA down"});
}

TEST(DrmDeskInputTest, AKeyWithNoEvdevMeaningIsDropped) {
  RecordingInjector injector;
  InjectDeskInput(injector,
                  {.kind = Kind::kKey, .code = 0xffff, .pressed = true});

  EXPECT_TRUE(injector.calls.empty());
}

}  // namespace
}  // namespace ui
