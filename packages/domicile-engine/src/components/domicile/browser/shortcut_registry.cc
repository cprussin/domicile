// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shortcut_registry.h"

#include <linux/input.h>

#include <algorithm>
#include <utility>

#include "base/logging.h"
#include "base/no_destructor.h"

namespace domicile {

namespace {

// Whether `keycode` is one of the keys a chord's modifiers are held on.
bool IsModifierKey(uint32_t keycode) {
  switch (keycode) {
    case KEY_LEFTALT:
    case KEY_RIGHTALT:
    case KEY_LEFTCTRL:
    case KEY_RIGHTCTRL:
    case KEY_LEFTSHIFT:
    case KEY_RIGHTSHIFT:
    case KEY_LEFTMETA:
    case KEY_RIGHTMETA:
      return true;
    default:
      return false;
  }
}

}  // namespace

// static
ShortcutRegistry& ShortcutRegistry::Get() {
  static base::NoDestructor<ShortcutRegistry> registry;
  return *registry;
}

ShortcutRegistry::ShortcutRegistry() = default;

ShortcutRegistry::~ShortcutRegistry() = default;

ShortcutRegistry::ChannelId ShortcutRegistry::AddChannel(
    Page page,
    ShortcutCallback on_shortcut,
    ShortcutCallback on_release,
    ModifiersCallback on_modifiers) {
  base::AutoLock held(lock_);
  const ChannelId id = next_id_++;
  channels_.push_back(Channel{id, page, std::move(on_shortcut),
                              std::move(on_release), std::move(on_modifiers)});
  return id;
}

void ShortcutRegistry::RemoveChannel(ChannelId channel) {
  base::AutoLock held(lock_);
  std::erase_if(channels_, [channel](const Channel& registered) {
    return registered.id == channel;
  });
}

void ShortcutRegistry::Grab(const Chord& chord) {
  base::AutoLock held(lock_);
  if (!IsGrabbed(chord)) {
    grabbed_.push_back(chord);
  }
}

bool ShortcutRegistry::Press(const Chord& chord, const Page& page) {
  // Run callbacks outside the lock, since a callback may re-enter the
  // registry.
  std::vector<ShortcutCallback> tell;
  {
    base::AutoLock held(lock_);
    if (!IsGrabbed(chord)) {
      return false;
    }
    for (const Channel& channel : channels_) {
      if (channel.page == page) {
        tell.push_back(channel.on_shortcut);
      }
    }
  }

  // The key is still swallowed, since the claim is process-wide. Warn because
  // nothing handles it.
  LOG_IF(WARNING, tell.empty())
      << "domicile: a claimed chord was pressed in a page with no control "
         "channel; nothing answers it";
  for (const ShortcutCallback& channel : tell) {
    channel.Run(chord);
  }
  return true;
}

void ShortcutRegistry::Release(const Chord& chord, const Page& page) {
  std::vector<ShortcutCallback> tell;
  {
    base::AutoLock held(lock_);
    if (!IsGrabbedKey(chord.keycode) && !IsModifierKey(chord.keycode)) {
      return;
    }
    for (const Channel& channel : channels_) {
      if (channel.page == page) {
        tell.push_back(channel.on_release);
      }
    }
  }

  for (const ShortcutCallback& channel : tell) {
    channel.Run(chord);
  }
}

bool ShortcutRegistry::IsGrabbed(const Chord& chord) const {
  return std::ranges::find(grabbed_, chord) != grabbed_.end();
}

bool ShortcutRegistry::IsGrabbedKey(uint32_t keycode) const {
  return std::ranges::any_of(grabbed_, [keycode](const Chord& chord) {
    return chord.keycode == keycode;
  });
}

void ShortcutRegistry::SetModifiers(const Modifiers& modifiers) {
  std::vector<ModifiersCallback> tell;
  {
    base::AutoLock held(lock_);
    if (reported_.has_value() && *reported_ == modifiers) {
      return;
    }
    reported_ = modifiers;
    tell.reserve(channels_.size());
    for (const Channel& channel : channels_) {
      tell.push_back(channel.on_modifiers);
    }
  }

  for (const ModifiersCallback& channel : tell) {
    channel.Run(modifiers);
  }
}

}  // namespace domicile
