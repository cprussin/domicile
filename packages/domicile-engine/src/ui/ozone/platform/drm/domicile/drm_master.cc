// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_master.h"

#include <xf86drm.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"

namespace ui {

DrmMaster::DrmMaster()
    : DrmMaster(base::BindRepeating([](int fd) { return drmSetMaster(fd); }),
                base::BindRepeating([](int fd) { return drmDropMaster(fd); })) {
}

DrmMaster::DrmMaster(DrmMasterCall set_master, DrmMasterCall drop_master)
    : set_master_(std::move(set_master)),
      drop_master_(std::move(drop_master)) {}

DrmMaster::~DrmMaster() = default;

void DrmMaster::Add(const base::FilePath& device, base::ScopedFD fd) {
  cards_[device] = std::move(fd);
}

void DrmMaster::Forget(const base::FilePath& device) {
  cards_.erase(device);
}

bool DrmMaster::Take() {
  return ApplyToEveryCard(set_master_, "take");
}

bool DrmMaster::Drop() {
  return ApplyToEveryCard(drop_master_, "drop");
}

bool DrmMaster::ApplyToEveryCard(const DrmMasterCall& call, const char* verb) {
  if (cards_.empty()) {
    LOG(ERROR) << "asked to " << verb << " DRM master while holding no card";
    return false;
  }

  bool every_card_agreed = true;
  for (const auto& [device, fd] : cards_) {
    const int result = call.Run(fd.get());
    if (result != 0) {
      LOG(ERROR) << "failed to " << verb << " DRM master on " << device.value()
                 << ": " << result;
      every_card_agreed = false;
    }
  }

  return every_card_agreed;
}

}  // namespace ui
