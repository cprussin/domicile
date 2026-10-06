// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_master.h"

#include <xf86drm.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"

namespace ui {

namespace {

// Runs `call` on one card and logs a failure. Callers have no remedy, so the
// log, naming the card, is the only report.
bool Ask(const DrmMasterCall& call,
         const char* verb,
         const base::FilePath& device,
         int fd) {
  const int result = call.Run(fd);
  if (result != 0) {
    LOG(ERROR) << "failed to " << verb << " DRM master on " << device.value()
               << ": " << result;
  }
  return result == 0;
}

}  // namespace

DrmMaster::DrmMaster()
    : DrmMaster(base::BindRepeating([](int fd) { return drmSetMaster(fd); }),
                base::BindRepeating([](int fd) { return drmDropMaster(fd); })) {
}

DrmMaster::DrmMaster(DrmMasterCall set_master, DrmMasterCall drop_master)
    : set_master_(std::move(set_master)),
      drop_master_(std::move(drop_master)) {}

DrmMaster::~DrmMaster() = default;

void DrmMaster::Add(const base::FilePath& device, base::ScopedFD fd) {
  // Take master before anything can commit on the card (see the header).
  // Record the card even if the take fails, so a console switch still drops
  // it.
  if (display_is_ours_) {
    Ask(set_master_, "take", device, fd.get());
  }
  cards_[device] = std::move(fd);
}

void DrmMaster::Forget(const base::FilePath& device) {
  cards_.erase(device);
}

void DrmMaster::ForgetEvery() {
  cards_.clear();
}

bool DrmMaster::Take() {
  display_is_ours_ = true;
  return ApplyToEveryCard(set_master_, "take");
}

bool DrmMaster::Drop() {
  display_is_ours_ = false;
  return ApplyToEveryCard(drop_master_, "drop");
}

bool DrmMaster::ApplyToEveryCard(const DrmMasterCall& call, const char* verb) {
  if (cards_.empty()) {
    LOG(ERROR) << "asked to " << verb << " DRM master while holding no card";
    return false;
  }

  bool every_card_agreed = true;
  for (const auto& [device, fd] : cards_) {
    every_card_agreed &= Ask(call, verb, device, fd.get());
  }

  return every_card_agreed;
}

}  // namespace ui
