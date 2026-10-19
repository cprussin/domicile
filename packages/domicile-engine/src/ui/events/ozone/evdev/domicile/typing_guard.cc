// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/typing_guard.h"

#include <linux/input-event-codes.h>

#include <algorithm>
#include <array>

namespace ui {

namespace {

// libinput's two timeouts: a lone key rests the pads briefly, and a key
// pressed while they rest means typing, which rests them longer.
constexpr base::TimeDelta kOneKey = base::Milliseconds(200);
constexpr base::TimeDelta kTyping = base::Milliseconds(500);

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
  enabled_ = enabled;
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
    resting_until_ = time + (Resting(time) ? kTyping : kOneKey);
  }
}

bool TypingGuard::DropsMotion(base::TimeTicks time) const {
  return enabled_ && buttons_passed_.empty() && Resting(time);
}

bool TypingGuard::DropsButton(unsigned int button,
                              bool down,
                              base::TimeTicks time) {
  if (!down) {
    buttons_passed_.erase(button);
    return buttons_dropped_.erase(button) > 0;
  }
  const bool drops = enabled_ && Resting(time);
  if (drops) {
    buttons_dropped_.insert(button);
  } else {
    buttons_passed_.insert(button);
  }
  return drops;
}

bool TypingGuard::Resting(base::TimeTicks time) const {
  return resting_until_.has_value() && time < *resting_until_;
}

}  // namespace ui
