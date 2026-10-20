// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity.h"

#include <utility>
#include <vector>

#include "base/no_destructor.h"

namespace domicile {

// static
DeskActivity& DeskActivity::Get() {
  static base::NoDestructor<DeskActivity> activity;
  return *activity;
}

DeskActivity::DeskActivity() = default;
DeskActivity::~DeskActivity() = default;

DeskActivity::ListenerId DeskActivity::AddListener(
    base::RepeatingClosure heard) {
  base::AutoLock held(lock_);
  const ListenerId id = next_id_++;
  listeners_.emplace_back(id, std::move(heard));
  return id;
}

void DeskActivity::RemoveListener(ListenerId listener) {
  base::AutoLock held(lock_);
  std::erase_if(listeners_, [listener](const auto& registered) {
    return registered.first == listener;
  });
}

void DeskActivity::Heard() {
  // Run outside the lock, since a callback may re-enter this.
  std::vector<base::RepeatingClosure> tell;
  {
    base::AutoLock held(lock_);
    for (const auto& listener : listeners_) {
      tell.push_back(listener.second);
    }
  }
  for (const base::RepeatingClosure& heard : tell) {
    heard.Run();
  }
}

}  // namespace domicile
