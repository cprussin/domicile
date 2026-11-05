// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/typing_guard.h"

#include <linux/input-event-codes.h>

#include <algorithm>
#include <array>

namespace ui {

namespace {

// Recognition stays independent of the configured suppression durations.
constexpr base::TimeDelta kTypingRecognitionWindow = base::Milliseconds(200);

// Held, these make a key a shortcut. Shift is left out: Shift+A is typing.
constexpr std::array<unsigned int, 6> kShortcutModifiers = {
    KEY_LEFTCTRL, KEY_RIGHTCTRL, KEY_LEFTALT,
    KEY_RIGHTALT, KEY_LEFTMETA,  KEY_RIGHTMETA};

// The letters, digits, punctuation, Enter, Backspace, Tab and Space: every
// code below F1 that is not a modifier or Caps Lock. Function, media and
// navigation keys come after F1.
bool IsTyping(unsigned int key) {
  return key < KEY_F1 && key != KEY_LEFTCTRL && key != KEY_LEFTSHIFT &&
         key != KEY_RIGHTSHIFT && key != KEY_LEFTALT && key != KEY_CAPSLOCK;
}

}  // namespace

TypingGuard::TypingGuard() = default;
TypingGuard::~TypingGuard() = default;

void TypingGuard::SetEnabled(bool enabled) {
  if (enabled_ != enabled) {
    ResetPause();
  }
  enabled_ = enabled;
}

void TypingGuard::ResetPause() {
  resting_until_.reset();
  last_typing_key_.reset();
}

void TypingGuard::RemoveDevice(int device_id) {
  const auto matches = [device_id](const auto& button) {
    return button.first == device_id;
  };
  base::EraseIf(buttons_passed_, matches);
  base::EraseIf(buttons_dropped_, matches);
}

void TypingGuard::SetPauses(base::TimeDelta one_key, base::TimeDelta typing) {
  if (one_key_ != one_key || typing_ != typing) {
    ResetPause();
    one_key_ = one_key;
    typing_ = typing;
  }
}

void TypingGuard::OnKey(unsigned int key, bool down, base::TimeTicks time) {
  if (std::ranges::contains(kShortcutModifiers, key)) {
    if (down) {
      shortcut_modifiers_held_.insert(key);
    } else {
      shortcut_modifiers_held_.erase(key);
    }
    return;
  }
  if (down && IsTyping(key) && shortcut_modifiers_held_.empty()) {
    const bool continuing =
        Resting(time) || (last_typing_key_.has_value() &&
                          time - *last_typing_key_ < kTypingRecognitionWindow);
    resting_until_ = time + (continuing ? typing_ : one_key_);
    last_typing_key_ = time;
  }
}

bool TypingGuard::DropsMotion(base::TimeTicks time, int device_id) const {
  const bool dragging = std::ranges::any_of(
      buttons_passed_,
      [device_id](const auto& button) { return button.first == device_id; });
  return enabled_ && !dragging && Resting(time);
}

bool TypingGuard::DropsButton(unsigned int button,
                              bool down,
                              base::TimeTicks time,
                              bool applies,
                              int device_id) {
  const auto identity = std::pair(device_id, button);
  if (!down) {
    buttons_passed_.erase(identity);
    return buttons_dropped_.erase(identity) > 0;
  }
  const bool drops = enabled_ && applies && Resting(time);
  if (drops) {
    buttons_dropped_.insert(identity);
  } else {
    buttons_passed_.insert(identity);
  }
  return drops;
}

bool TypingGuard::Resting(base::TimeTicks time) const {
  return resting_until_.has_value() && time < *resting_until_;
}

}  // namespace ui
