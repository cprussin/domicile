// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_holds.h"

#include "base/check.h"
#include "base/check_op.h"

namespace domicile {

SurfaceHolds::SurfaceHolds() = default;

SurfaceHolds::~SurfaceHolds() = default;

void SurfaceHolds::Sent(uint64_t buffer) {
  ++held_[buffer];
}

SurfaceHolds::Return SurfaceHolds::Returned(uint64_t buffer, int count) {
  auto iter = held_.find(buffer);
  CHECK(iter != held_.end()) << "domicile: viz returned a buffer never sent";
  iter->second -= count;
  CHECK_GE(iter->second, 0) << "domicile: viz returned more than it held";
  if (iter->second == 0) {
    held_.erase(iter);
  }
  if (!destroyed_.contains(buffer)) {
    return Return::kRelease;
  }
  if (held_.contains(buffer)) {
    return Return::kKeep;
  }
  destroyed_.erase(buffer);
  return Return::kDestroy;
}

bool SurfaceHolds::Destroyed(uint64_t buffer) {
  if (!held_.contains(buffer)) {
    return true;
  }
  destroyed_.insert(buffer);
  return false;
}

}  // namespace domicile
