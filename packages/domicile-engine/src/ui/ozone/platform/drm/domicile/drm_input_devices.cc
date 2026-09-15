// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

#include <sys/stat.h>
#include <sys/sysmacros.h>

#include <string>
#include <utility>

#include "base/logging.h"

namespace ui {

namespace {

// logind's three, spelled as it spells them.
constexpr char kPauseTypePause[] = "pause";
constexpr char kPauseTypeGone[] = "gone";

}  // namespace

int StatDevice(const base::FilePath& path, struct stat* out) {
  return stat(path.value().c_str(), out);
}

std::optional<DeviceNumber> NumberOfDevice(const base::FilePath& path,
                                           const StatCall& stat_call) {
  struct stat node = {};
  if (stat_call.Run(path, &node) != 0) {
    PLOG(ERROR) << "cannot stat " << path.value();
    return std::nullopt;
  }

  if (!S_ISCHR(node.st_mode)) {
    LOG(ERROR) << path.value() << " is not a character device, so there is no "
               << "device for logind to hand over";
    return std::nullopt;
  }

  return DeviceNumber{major(node.st_rdev), minor(node.st_rdev)};
}

DrmTakenDevices::DrmTakenDevices(ReleaseDeviceCall release,
                                 ReopenDeviceCall reopen)
    : release_(std::move(release)), reopen_(std::move(reopen)) {}

DrmTakenDevices::~DrmTakenDevices() {
  Release();
}

void DrmTakenDevices::Take(DeviceNumber number,
                           int id,
                           const base::FilePath& path) {
  devices_[number] = Device{id, path};
}

base::ScopedFD DrmTakenDevices::Resumed(const base::FilePath& path) {
  const auto waiting = resumed_.find(path);
  if (waiting == resumed_.end()) {
    return base::ScopedFD();
  }

  // ERASED AS IT IS HANDED OVER. A descriptor left behind would be given to
  // the next open of this path -- a real hotplug months later -- instead of
  // the one logind would hand out then.
  base::ScopedFD descriptor = std::move(waiting->second);
  resumed_.erase(waiting);
  return descriptor;
}

PauseAnswer DrmTakenDevices::Pause(DeviceNumber number,
                                   std::string_view type) {
  if (type == kPauseTypeGone) {
    // The node is unplugged. There is nothing left to give back, and udev's
    // own removal is what takes the converter down -- so forgetting it is the
    // whole of the handling.
    devices_.erase(number);
    return PauseAnswer::kNothingToSay;
  }

  if (!devices_.contains(number)) {
    // logind pauses only what it handed over, so this is an invariant
    // violation and says so. It is still answered below: silence here leaves
    // the console wedged until logind's own timeout, which is worse than an
    // answer about a device nobody holds.
    LOG(ERROR) << "logind paused device " << number.major << ":" << number.minor
               << ", which this session never took";
  }

  return type == kPauseTypePause ? PauseAnswer::kCompleteIt
                                 : PauseAnswer::kNothingToSay;
}

bool DrmTakenDevices::Resume(DeviceNumber number, base::ScopedFD descriptor) {
  const auto taken = devices_.find(number);
  if (taken == devices_.end()) {
    LOG(ERROR) << "logind resumed device " << number.major << ":"
               << number.minor << ", which this session never took";
    return false;
  }

  // COPIED OUT BEFORE THE REOPEN, because the reopen runs `OpenInputDevice`
  // synchronously and that comes straight back here for `Resumed` -- so
  // nothing may be standing on an iterator into either table when it is
  // called.
  const int id = taken->second.id;
  const base::FilePath path = taken->second.path;
  resumed_[path] = std::move(descriptor);

  // A resume for a device that was never paused lands here too, and is taken
  // rather than refused: logind resumes every device on session activation
  // whether or not it paused that one, and the descriptor it sends is the
  // authoritative one.
  reopen_.Run(id, path);
  return true;
}

bool DrmTakenDevices::Release() {
  // EVERY DEVICE IS ASKED EVEN AFTER ONE REFUSES, for the reason
  // `DrmMaster::ApplyToEveryCard` gives: logind hands a device to the next
  // session only once every holder has let go of it, so stopping at the first
  // refusal strands the rest with this session on its way out.
  bool every_device_agreed = true;
  for (const auto& [number, device] : devices_) {
    if (!release_.Run(number)) {
      LOG(ERROR) << "logind refused to take back " << device.path.value()
                 << " (" << number.major << ":" << number.minor << ")";
      every_device_agreed = false;
    }
  }

  // Emptied rather than left, because the destructor releases too and a
  // shutdown that releases explicitly is the ordinary path.
  devices_.clear();
  resumed_.clear();
  return every_device_agreed;
}

}  // namespace ui
