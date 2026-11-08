// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_gestures.h"

#include <algorithm>
#include <utility>

#include "base/check.h"
#include "base/no_destructor.h"

namespace domicile {

// static
DeskGestures& DeskGestures::Get() {
  static base::NoDestructor<DeskGestures> gestures;
  static const bool installed = [] {
    ui::NativeGestureSink::Set(gestures.get());
    return true;
  }();
  CHECK(installed);
  return *gestures;
}

DeskGestures::DeskGestures() = default;
DeskGestures::~DeskGestures() = default;

DeskGestures::ChannelId DeskGestures::AddChannel(Performed performed) {
  base::AutoLock held(lock_);
  const ChannelId id = next_id_++;
  channels_.push_back(Channel{id, std::move(performed), {}});
  return id;
}

void DeskGestures::RemoveChannel(ChannelId channel) {
  base::AutoLock held(lock_);
  std::erase_if(channels_, [channel](const Channel& registered) {
    return registered.id == channel;
  });
  if (owner_ == channel) {
    owner_.reset();
  }
}

void DeskGestures::Grab(ChannelId channel, GestureGrab grab) {
  base::AutoLock held(lock_);
  auto found = std::ranges::find(channels_, channel, &Channel::id);
  CHECK(found != channels_.end());
  if (std::ranges::find(found->grabs, grab) == found->grabs.end()) {
    found->grabs.push_back(grab);
  }
}

void DeskGestures::Ungrab(ChannelId channel, GestureGrab grab) {
  base::AutoLock held(lock_);
  auto found = std::ranges::find(channels_, channel, &Channel::id);
  CHECK(found != channels_.end());
  std::erase(found->grabs, grab);
}

bool DeskGestures::Takes(const ui::NativeGesture& begin) {
  base::AutoLock held(lock_);
  return Grabbing(begin) != nullptr;
}

void DeskGestures::Take(const ui::NativeGesture& gesture) {
  Performed tell;
  {
    base::AutoLock held(lock_);
    if (gesture.phase == ui::NativeGesturePhase::kBegin) {
      const Channel* grabbing = Grabbing(gesture);
      owner_ = grabbing ? std::optional<ChannelId>(grabbing->id)
                        : std::nullopt;
    }
    if (!owner_) {
      return;
    }
    auto found = std::ranges::find(channels_, *owner_, &Channel::id);
    CHECK(found != channels_.end());
    tell = found->performed;
    if (gesture.phase == ui::NativeGesturePhase::kEnd) {
      owner_.reset();
    }
  }
  tell.Run(gesture);
}

const DeskGestures::Channel* DeskGestures::Grabbing(
    const ui::NativeGesture& begin) const {
  auto found = std::ranges::find_if(channels_, [&](const Channel& channel) {
    return std::ranges::any_of(channel.grabs, [&](const GestureGrab& grab) {
      return grab.kind == begin.kind &&
             (grab.fingers == 0 || grab.fingers == begin.fingers) &&
             (!grab.edge || grab.edge == begin.edge);
    });
  });
  return found == channels_.end() ? nullptr : &*found;
}

}  // namespace domicile
