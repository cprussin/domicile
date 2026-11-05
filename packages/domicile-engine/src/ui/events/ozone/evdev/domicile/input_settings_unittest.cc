// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/input_settings.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

TEST(InputSettingsTest, OmittedValuesResetToDesktopDefaults) {
  const auto settings = ParseDomicileInputSettings("{}");
  ASSERT_TRUE(settings.has_value());
  EXPECT_TRUE(settings->touchpad.tap);
  EXPECT_TRUE(settings->touchpad.tap_drag);
  EXPECT_FALSE(settings->touchpad.natural_scroll);
  EXPECT_EQ(settings->touchpad.click_method, DomicileClickMethod::kDefault);
  EXPECT_EQ(settings->touchpad.scroll_method, DomicileScrollMethod::kDefault);
  EXPECT_EQ(settings->touchpad.typing_pause, base::Milliseconds(200));
  EXPECT_EQ(settings->touchpad.typing_repeat_pause, base::Milliseconds(500));
  EXPECT_EQ(settings->mouse.speed, 0);
}

TEST(InputSettingsTest, ParsesEachIndependentDeviceClass) {
  const auto settings = ParseDomicileInputSettings(R"({
    "touchpad":{"tap":false,"tap_button_map":"lmr","tap_drag":false,
      "drag_lock":true,"natural_scroll":true,"accel_profile":"flat",
      "speed":-0.35,"click_method":"clickfinger","middle_emulation":true,
      "scroll_method":"two_finger","scroll_factor":0.25,
      "scroll_acceleration":false,"disable_while_typing":"internal",
      "typing_pause_ms":0,"typing_repeat_pause_ms":1000},
    "mouse":{"speed":0.4,"accel_profile":"adaptive","natural_scroll":true,
      "middle_emulation":true,"scroll_factor":2.5}})");
  ASSERT_TRUE(settings.has_value());
  EXPECT_FALSE(settings->touchpad.tap);
  EXPECT_EQ(settings->touchpad.tap_button_map, DomicileTapButtonMap::kLmr);
  EXPECT_FALSE(settings->touchpad.tap_drag);
  EXPECT_TRUE(settings->touchpad.drag_lock);
  EXPECT_TRUE(settings->touchpad.natural_scroll);
  EXPECT_EQ(settings->touchpad.accel_profile, DomicileAccelProfile::kFlat);
  EXPECT_EQ(settings->touchpad.speed, -0.35);
  EXPECT_EQ(settings->touchpad.click_method, DomicileClickMethod::kClickfinger);
  EXPECT_TRUE(settings->touchpad.middle_emulation);
  EXPECT_EQ(settings->touchpad.scroll_method, DomicileScrollMethod::kTwoFinger);
  EXPECT_EQ(settings->touchpad.scroll_factor, 0.25);
  EXPECT_FALSE(settings->touchpad.scroll_acceleration);
  EXPECT_EQ(settings->touchpad.disable_while_typing,
            DomicileTypingPolicy::kInternal);
  EXPECT_EQ(settings->touchpad.typing_pause, base::Milliseconds(0));
  EXPECT_EQ(settings->touchpad.typing_repeat_pause, base::Milliseconds(1000));
  EXPECT_EQ(settings->mouse.speed, 0.4);
  EXPECT_EQ(settings->mouse.accel_profile, DomicileAccelProfile::kAdaptive);
  EXPECT_TRUE(settings->mouse.natural_scroll);
  EXPECT_TRUE(settings->mouse.middle_emulation);
  EXPECT_EQ(settings->mouse.scroll_factor, 2.5);
}

TEST(InputSettingsTest, NativeTypingPolicyUsesLibinputTiming) {
  const auto settings = ParseDomicileInputSettings(
      R"({"touchpad":{"disable_while_typing":"libinput"}})");
  ASSERT_TRUE(settings.has_value());
  EXPECT_EQ(settings->touchpad.disable_while_typing,
            DomicileTypingPolicy::kLibinput);
  for (
      const char* invalid :
      {R"({"touchpad":{"disable_while_typing":"libinput","typing_pause_ms":0}})",
       R"({"touchpad":{"disable_while_typing":"libinput","typing_repeat_pause_ms":100}})"}) {
    const auto rejected = ParseDomicileInputSettings(invalid);
    ASSERT_FALSE(rejected.has_value()) << invalid;
    EXPECT_NE(rejected.error().find("libinput"), std::string::npos);
  }
}

TEST(InputSettingsTest, RejectsMalformedAndOutOfRangeConfiguration) {
  for (const char* invalid :
       {"[]", "{", R"({"unknown":true})", R"({"touchpad":[]})",
        R"({"touchpad":{"tap":1}})", R"({"mouse":{"speed":1.01}})",
        R"({"mouse":{"speed":-1.01}})", R"({"mouse":{"scroll_factor":0}})",
        R"({"touchpad":{"typing_pause_ms":-1}})",
        R"({"touchpad":{"typing_repeat_pause_ms":0.5}})",
        R"({"touchpad":{"tap_button_map":"bad"}})",
        R"({"touchpad":{"click_method":"bad"}})",
        R"({"touchpad":{"scroll_method":"bad"}})",
        R"({"touchpad":{"disable_while_typing":"bad"}})",
        R"({"mouse":{"accel_profile":"bad"}})"}) {
    const auto settings = ParseDomicileInputSettings(invalid);
    ASSERT_FALSE(settings.has_value()) << invalid;
    EXPECT_FALSE(settings.error().empty());
  }
}

TEST(InputSettingsTest, TypingPolicySelectsInternalAndExternalPads) {
  EXPECT_TRUE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kEnabled, false));
  EXPECT_TRUE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kEnabled, true));
  EXPECT_TRUE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kDisabled, false));
  EXPECT_TRUE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kDisabled, true));
  EXPECT_FALSE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kInternal, false));
  EXPECT_TRUE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kInternal, true));
  EXPECT_FALSE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kLibinput, false));
  EXPECT_FALSE(
      DomicileTypingDeviceEligible(DomicileTypingPolicy::kLibinput, true));
}

TEST(InputSettingsTest, UnsupportedMethodsAreReportedWithoutChangingDefaults) {
  EXPECT_EQ(SelectDomicileLibinputMethod(0, 1, 1).value(), 1u);
  EXPECT_EQ(SelectDomicileLibinputMethod(2, 3, 1).value(), 2u);
  EXPECT_FALSE(SelectDomicileLibinputMethod(2, 1, 1).has_value());
}

}  // namespace
}  // namespace ui
