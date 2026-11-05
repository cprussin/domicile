// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_INPUT_SETTINGS_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_INPUT_SETTINGS_H_

#include <string>
#include <string_view>

#include "base/component_export.h"
#include "base/time/time.h"
#include "base/types/expected.h"

namespace ui {

enum class DomicileAccelProfile { kAdaptive, kFlat };
enum class DomicileTapButtonMap { kLrm, kLmr };
enum class DomicileClickMethod { kDefault, kClickfinger, kButtonAreas };
enum class DomicileScrollMethod { kDefault, kTwoFinger, kEdge, kOnButtonDown };
enum class DomicileTypingPolicy { kEnabled, kDisabled, kInternal, kLibinput };

struct DomicileMouseSettings {
  DomicileAccelProfile accel_profile = DomicileAccelProfile::kAdaptive;
  double speed = 0;
  bool natural_scroll = false;
  bool middle_emulation = false;
  double scroll_factor = 1;
};

struct DomicileTouchpadSettings : DomicileMouseSettings {
  bool tap = true;
  DomicileTapButtonMap tap_button_map = DomicileTapButtonMap::kLrm;
  bool tap_drag = true;
  bool drag_lock = false;
  DomicileClickMethod click_method = DomicileClickMethod::kDefault;
  DomicileScrollMethod scroll_method = DomicileScrollMethod::kDefault;
  bool scroll_acceleration = true;
  DomicileTypingPolicy disable_while_typing = DomicileTypingPolicy::kEnabled;
  base::TimeDelta typing_pause = base::Milliseconds(200);
  base::TimeDelta typing_repeat_pause = base::Milliseconds(500);
};

struct DomicileInputSettings {
  DomicileTouchpadSettings touchpad;
  DomicileMouseSettings mouse;
};

// Parses the compositor's complete input settings; omitted values reset to
// defaults.
COMPONENT_EXPORT(EVDEV)
base::expected<DomicileInputSettings, std::string> ParseDomicileInputSettings(
    std::string_view json);

// Selects pads for the custom guard; native libinput mode bypasses it.
COMPONENT_EXPORT(EVDEV)
bool DomicileTypingDeviceEligible(DomicileTypingPolicy policy, bool internal);

// Zero requests the device's default; an unavailable explicit method is an
// error.
COMPONENT_EXPORT(EVDEV)
base::expected<unsigned int, std::string> SelectDomicileLibinputMethod(
    unsigned int requested,
    unsigned int supported,
    unsigned int device_default);

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_INPUT_SETTINGS_H_
