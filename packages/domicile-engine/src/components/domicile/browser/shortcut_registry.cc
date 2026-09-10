// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shortcut_registry.h"

#include <algorithm>
#include <utility>

#include "base/no_destructor.h"

namespace domicile {

// static
ShortcutRegistry& ShortcutRegistry::Get() {
  static base::NoDestructor<ShortcutRegistry> registry;
  return *registry;
}

ShortcutRegistry::ShortcutRegistry() = default;

ShortcutRegistry::~ShortcutRegistry() = default;

ShortcutRegistry::ChannelId ShortcutRegistry::AddChannel(
    ShortcutCallback on_shortcut,
    ModifiersCallback on_modifiers) {
  base::AutoLock held(lock_);
  const ChannelId id = next_id_++;
  channels_.push_back(
      Channel{id, std::move(on_shortcut), std::move(on_modifiers)});
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

bool ShortcutRegistry::Press(const Chord& chord) {
  // Copied out under the lock and run outside it. A channel's callback is
  // whatever the page's end of the pipe wanted to do next, and running it with
  // this held would make every one of those a place the lock can be taken
  // twice.
  std::vector<ShortcutCallback> tell;
  {
    base::AutoLock held(lock_);
    if (!IsGrabbed(chord)) {
      return false;
    }
    tell.reserve(channels_.size());
    for (const Channel& channel : channels_) {
      tell.push_back(channel.on_shortcut);
    }
  }

  for (const ShortcutCallback& channel : tell) {
    channel.Run(chord);
  }
  return true;
}

bool ShortcutRegistry::IsGrabbed(const Chord& chord) const {
  return std::ranges::find(grabbed_, chord) != grabbed_.end();
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
