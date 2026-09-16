// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_master.h"

#include <xf86drm.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"

namespace ui {

namespace {

// One card, one call, and the refusal said out loud where it happened. No
// caller of any of these has a remedy the kernel would accept, so the log is
// the whole of the reporting and it names the card.
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
  // See the header: nothing else in this fork ever asks the kernel for master,
  // and a card is gained before anything can commit on it. Recorded either
  // way, because a card that refused a take is still one to drop on the way
  // to another console.
  if (display_is_ours_) {
    Ask(set_master_, "take", device, fd.get());
  }
  cards_[device] = std::move(fd);
}

void DrmMaster::Forget(const base::FilePath& device) {
  cards_.erase(device);
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
