// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_pointer_hiding.h"

#include <utility>
#include <vector>

#include "base/no_destructor.h"

namespace domicile {

// static
DeskPointerHiding& DeskPointerHiding::Get() {
  static base::NoDestructor<DeskPointerHiding> hiding;
  return *hiding;
}

DeskPointerHiding::DeskPointerHiding() = default;
DeskPointerHiding::~DeskPointerHiding() = default;

DeskPointerHiding::ListenerId DeskPointerHiding::AddListener(Changed changed) {
  base::AutoLock held(lock_);
  const ListenerId id = next_id_++;
  listeners_.emplace_back(id, std::move(changed));
  return id;
}

void DeskPointerHiding::RemoveListener(ListenerId listener) {
  base::AutoLock held(lock_);
  std::erase_if(listeners_, [listener](const auto& registered) {
    return registered.first == listener;
  });
}

PointerHidingSettings DeskPointerHiding::Now() {
  base::AutoLock held(lock_);
  return settings_;
}

void DeskPointerHiding::Set(const PointerHidingSettings& settings) {
  // Run outside the lock, since a callback may re-enter this.
  std::vector<Changed> tell;
  {
    base::AutoLock held(lock_);
    if (settings == settings_) {
      return;
    }
    settings_ = settings;
    for (const auto& listener : listeners_) {
      tell.push_back(listener.second);
    }
  }
  for (const Changed& changed : tell) {
    changed.Run(settings);
  }
}

}  // namespace domicile
