// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_lock.h"

#include <atomic>

namespace domicile {

namespace {

std::atomic<bool> g_locked{false};

}  // namespace

// static
bool DeskLock::IsLocked() {
  return g_locked.load(std::memory_order_acquire);
}

// static
void DeskLock::Set(bool locked) {
  g_locked.store(locked, std::memory_order_release);
}

}  // namespace domicile
