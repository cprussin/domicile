// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_pointer.h"

#include <utility>
#include <vector>

#include "base/no_destructor.h"

namespace domicile {

// static
DeskPointer& DeskPointer::Get() {
  static base::NoDestructor<DeskPointer> pointer;
  return *pointer;
}

DeskPointer::DeskPointer() = default;
DeskPointer::~DeskPointer() = default;

DeskPointer::ListenerId DeskPointer::AddListener(Moved moved) {
  base::AutoLock held(lock_);
  const ListenerId id = next_id_++;
  listeners_.emplace_back(id, std::move(moved));
  return id;
}

void DeskPointer::RemoveListener(ListenerId listener) {
  base::AutoLock held(lock_);
  std::erase_if(listeners_, [listener](const auto& registered) {
    return registered.first == listener;
  });
}

void DeskPointer::MovedTo(const DeskPointerAt& at) {
  // Run outside the lock, since a callback may re-enter this.
  std::vector<Moved> tell;
  {
    base::AutoLock held(lock_);
    if (at == at_) {
      return;
    }
    at_ = at;
    for (const auto& listener : listeners_) {
      tell.push_back(listener.second);
    }
  }
  for (const Moved& moved : tell) {
    moved.Run(at);
  }
}

}  // namespace domicile
