// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/agent_input_lines.h"

#include <cmath>
#include <limits>
#include <string_view>

namespace domicile {

namespace {

// JSON carries a number as a double, which holds every integer up to 2^53
// exactly. Serials are microseconds since the epoch, codes evdev's: a value
// past that is not one of them.
template <typename T>
std::optional<T> Whole(const base::DictValue& message, std::string_view key) {
  const std::optional<double> number = message.FindDouble(key);
  if (!number || *number < 0 || std::floor(*number) != *number ||
      *number > 9007199254740992.0 ||
      *number > static_cast<double>(std::numeric_limits<T>::max())) {
    return std::nullopt;
  }
  return static_cast<T>(*number);
}

std::optional<AgentPageInput::Kind> KindNamed(std::string_view kind) {
  using Kind = AgentPageInput::Kind;
  if (kind == "pointer") {
    return Kind::kPointer;
  }
  if (kind == "button") {
    return Kind::kButton;
  }
  if (kind == "scroll") {
    return Kind::kScroll;
  }
  if (kind == "key") {
    return Kind::kKey;
  }
  if (kind == "focus") {
    return Kind::kFocus;
  }
  if (kind == "leave") {
    return Kind::kLeave;
  }
  if (kind == "blur") {
    return Kind::kBlur;
  }
  if (kind == "let_go") {
    return Kind::kLetGo;
  }
  if (kind == "gone") {
    return Kind::kGone;
  }
  return std::nullopt;
}

}  // namespace

std::optional<AgentPageInput> ReadAgentInput(const base::DictValue& message) {
  const std::optional<uint64_t> serial = Whole<uint64_t>(message, "serial");
  const std::string* seat = message.FindString("seat");
  const base::DictValue* input = message.FindDict("input");
  if (!serial || !seat || !input) {
    return std::nullopt;
  }
  const std::string* named = input->FindString("kind");
  const std::optional<AgentPageInput::Kind> kind =
      named ? KindNamed(*named) : std::nullopt;
  if (!kind) {
    return std::nullopt;
  }
  AgentPageInput read;
  read.serial = *serial;
  read.seat = *seat;
  read.kind = *kind;
  read.quiet = message.FindBool("quiet").value_or(false);
  if (const base::Value* barred = message.Find("barred")) {
    if (!barred->is_list()) {
      return std::nullopt;
    }
    for (const base::Value& window : barred->GetList()) {
      if (!window.is_string()) {
        return std::nullopt;
      }
      read.barred.push_back(window.GetString());
    }
  }
  using Kind = AgentPageInput::Kind;
  switch (*kind) {
    case Kind::kPointer: {
      const std::optional<double> x = input->FindDouble("x");
      const std::optional<double> y = input->FindDouble("y");
      if (!x || !y || !std::isfinite(*x) || !std::isfinite(*y)) {
        return std::nullopt;
      }
      read.at = gfx::PointF(*x, *y);
      break;
    }
    case Kind::kButton:
    case Kind::kKey: {
      const std::optional<uint32_t> code = Whole<uint32_t>(
          *input, *kind == Kind::kButton ? "button" : "keycode");
      const std::optional<bool> pressed = input->FindBool("pressed");
      if (!code || !pressed) {
        return std::nullopt;
      }
      read.code = *code;
      read.pressed = *pressed;
      break;
    }
    case Kind::kScroll: {
      const std::optional<double> dx = input->FindDouble("dx");
      const std::optional<double> dy = input->FindDouble("dy");
      if (!dx || !dy || !std::isfinite(*dx) || !std::isfinite(*dy)) {
        return std::nullopt;
      }
      read.scroll = gfx::Vector2dF(*dx, *dy);
      break;
    }
    case Kind::kFocus: {
      const std::string* window = input->FindString("window");
      if (!window) {
        return std::nullopt;
      }
      read.window = *window;
      break;
    }
    case Kind::kLeave:
    case Kind::kBlur:
    case Kind::kLetGo:
    case Kind::kGone:
      break;
  }
  return read;
}

base::DictValue AgentInputReachedMessage(
    uint64_t serial,
    const std::optional<std::string>& window,
    const std::optional<std::string>& refused) {
  base::DictValue message;
  message.Set("type", "agent_input_reached");
  // A double, which JSON writes with a `.0`, or in exponent form once it is
  // large (a clock serial is); either reads back whole in the compositor, as
  // a serial stays under 2^53. See Whole.
  message.Set("serial", static_cast<double>(serial));
  if (window) {
    message.Set("window", *window);
  }
  if (refused) {
    message.Set("refused", *refused);
  }
  return message;
}

base::DictValue PersonInAgentsWindowMessage(const std::string& seat,
                                            const std::string& window,
                                            bool keyboard) {
  base::DictValue message;
  message.Set("type", "person_in_agents_window");
  message.Set("seat", seat);
  message.Set("window", window);
  message.Set("keyboard", keyboard);
  return message;
}

}  // namespace domicile
