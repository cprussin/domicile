// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/input_settings.h"

#include <cmath>
#include <functional>
#include <initializer_list>
#include <optional>
#include <utility>
#include <vector>

#include "base/json/json_reader.h"
#include "base/notreached.h"
#include "base/values.h"

namespace ui {
namespace {

using Error = std::optional<std::string>;
using Reader = std::function<Error(const base::Value&)>;
using Fields = std::initializer_list<std::pair<std::string_view, Reader>>;

Error ReadFields(const base::Value& value, Fields fields) {
  if (!value.is_dict()) {
    return "expected an object";
  }
  for (const auto item : value.GetDict()) {
    bool found = false;
    for (const auto& field : fields) {
      if (item.first == field.first) {
        found = true;
        if (auto error = field.second(item.second)) {
          return item.first + ": " + *error;
        }
        break;
      }
    }
    if (!found) {
      return "unknown setting: " + item.first;
    }
  }
  return std::nullopt;
}

Reader Boolean(bool& target) {
  return [&target](const base::Value& value) -> Error {
    if (!value.is_bool()) {
      return "expected a boolean";
    }
    target = value.GetBool();
    return std::nullopt;
  };
}

Reader Number(double& target, bool speed) {
  return [&target, speed](const base::Value& value) -> Error {
    const auto number = value.GetIfDouble();
    if (!number || !std::isfinite(*number)) {
      return "expected a finite number";
    }
    if (speed ? *number < -1 || *number > 1 : *number <= 0) {
      return speed ? "expected a speed from -1 to 1"
                   : "expected a positive factor";
    }
    target = *number;
    return std::nullopt;
  };
}

Reader Pause(base::TimeDelta& target) {
  return [&target](const base::Value& value) -> Error {
    const auto milliseconds = value.GetIfInt();
    if (!milliseconds || *milliseconds < 0) {
      return "expected nonnegative integer milliseconds";
    }
    target = base::Milliseconds(*milliseconds);
    return std::nullopt;
  };
}

template <typename Enum>
Reader Choice(
    Enum& target,
    std::initializer_list<std::pair<std::string_view, Enum>> choices) {
  return [&target,
          choices = std::vector(choices)](const base::Value& value) -> Error {
    const auto* text = value.GetIfString();
    if (text) {
      for (const auto& [name, choice] : choices) {
        if (*text == name) {
          target = choice;
          return std::nullopt;
        }
      }
    }
    return "unknown option";
  };
}

Reader Profile(DomicileAccelProfile& target) {
  return Choice(target, {{"adaptive", DomicileAccelProfile::kAdaptive},
                         {"flat", DomicileAccelProfile::kFlat}});
}

Error ReadTouchpad(const base::Value& value, DomicileTouchpadSettings& pad) {
  return ReadFields(
      value,
      {
          {"tap", Boolean(pad.tap)},
          {"tap_button_map",
           Choice(pad.tap_button_map, {{"lrm", DomicileTapButtonMap::kLrm},
                                       {"lmr", DomicileTapButtonMap::kLmr}})},
          {"tap_drag", Boolean(pad.tap_drag)},
          {"drag_lock", Boolean(pad.drag_lock)},
          {"natural_scroll", Boolean(pad.natural_scroll)},
          {"accel_profile", Profile(pad.accel_profile)},
          {"speed", Number(pad.speed, true)},
          {"click_method",
           Choice(pad.click_method,
                  {{"default", DomicileClickMethod::kDefault},
                   {"clickfinger", DomicileClickMethod::kClickfinger},
                   {"button_areas", DomicileClickMethod::kButtonAreas}})},
          {"middle_emulation", Boolean(pad.middle_emulation)},
          {"scroll_method",
           Choice(pad.scroll_method,
                  {{"default", DomicileScrollMethod::kDefault},
                   {"two_finger", DomicileScrollMethod::kTwoFinger},
                   {"edge", DomicileScrollMethod::kEdge},
                   {"on_button_down", DomicileScrollMethod::kOnButtonDown}})},
          {"scroll_factor", Number(pad.scroll_factor, false)},
          {"scroll_acceleration", Boolean(pad.scroll_acceleration)},
          {"disable_while_typing",
           Choice(pad.disable_while_typing,
                  {{"enabled", DomicileTypingPolicy::kEnabled},
                   {"disabled", DomicileTypingPolicy::kDisabled},
                   {"internal", DomicileTypingPolicy::kInternal},
                   {"libinput", DomicileTypingPolicy::kLibinput}})},
          {"typing_pause_ms", Pause(pad.typing_pause)},
          {"typing_repeat_pause_ms", Pause(pad.typing_repeat_pause)},
      });
}

Error ReadMouse(const base::Value& value, DomicileMouseSettings& mouse) {
  return ReadFields(value,
                    {
                        {"accel_profile", Profile(mouse.accel_profile)},
                        {"speed", Number(mouse.speed, true)},
                        {"natural_scroll", Boolean(mouse.natural_scroll)},
                        {"middle_emulation", Boolean(mouse.middle_emulation)},
                        {"scroll_factor", Number(mouse.scroll_factor, false)},
                    });
}

}  // namespace

base::expected<DomicileInputSettings, std::string> ParseDomicileInputSettings(
    std::string_view json) {
  auto value = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  if (!value) {
    return base::unexpected("input settings must be valid JSON");
  }
  DomicileInputSettings settings;
  auto error =
      ReadFields(*value, {
                             {"touchpad",
                              [&settings](const base::Value& pad) {
                                return ReadTouchpad(pad, settings.touchpad);
                              }},
                             {"mouse",
                              [&settings](const base::Value& mouse) {
                                return ReadMouse(mouse, settings.mouse);
                              }},
                         });
  if (error) {
    return base::unexpected(*error);
  }
  if (settings.touchpad.disable_while_typing ==
          DomicileTypingPolicy::kLibinput &&
      (settings.touchpad.typing_pause != base::Milliseconds(200) ||
       settings.touchpad.typing_repeat_pause != base::Milliseconds(500))) {
    return base::unexpected(
        "touchpad: libinput mode uses native typing timing; keep "
        "typing_pause_ms=200 and typing_repeat_pause_ms=500");
  }
  return settings;
}

bool DomicileTypingDeviceEligible(DomicileTypingPolicy policy, bool internal) {
  switch (policy) {
    case DomicileTypingPolicy::kEnabled:
      return true;
    case DomicileTypingPolicy::kDisabled:
      return true;
    case DomicileTypingPolicy::kInternal:
      return internal;
    case DomicileTypingPolicy::kLibinput:
      return false;
  }
  NOTREACHED();
}

base::expected<unsigned int, std::string> SelectDomicileLibinputMethod(
    unsigned int requested,
    unsigned int supported,
    unsigned int device_default) {
  if (requested == 0) {
    return device_default;
  }
  if ((requested & supported) == requested) {
    return requested;
  }
  return base::unexpected("requested method is not supported by this device");
}

}  // namespace ui
