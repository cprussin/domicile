// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

#include <sys/stat.h>
#include <sys/sysmacros.h>

#include <string>
#include <utility>
#include <vector>

#include "base/logging.h"

namespace ui {

namespace {

// logind's three, spelled as it spells them.
constexpr char kPauseTypePause[] = "pause";
constexpr char kPauseTypeForce[] = "force";
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
                           const base::FilePath& path,
                           DeviceLiveness liveness) {
  devices_[number] = Device{id, path, liveness};
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

  const auto taken = devices_.find(number);
  if (taken == devices_.end()) {
    // logind pauses only what it handed over, so this is an invariant
    // violation and says so. It is still answered below: silence here leaves
    // the console wedged until logind's own timeout, which is worse than an
    // answer about a device nobody holds.
    LOG(ERROR) << "logind paused device " << number.major << ":" << number.minor
               << ", which this session never took";
    return type == kPauseTypePause ? PauseAnswer::kCompleteIt
                                   : PauseAnswer::kNothingToSay;
  }

  if (type == kPauseTypeForce) {
    // THE DEVICE IS KEPT AND THE DESCRIPTOR IS WRITTEN OFF. logind has
    // already `EVIOCREVOKE`d it -- `session_device_pause_all` stops every
    // device in the session before it says a word -- but `s->devices` still
    // has this session down as the holder, so the device is still owed back
    // and still cannot be taken again until it has been given back.
    taken->second.liveness = DeviceLiveness::kRevoked;

    // COPIED OUT BEFORE THE REOPEN, for the reason `Resume` copies one: the
    // reopen runs `OpenInputDevice` synchronously and that comes straight
    // back here, so nothing may be standing on an iterator into `devices_`
    // when it is called.
    const int id = taken->second.id;
    const base::FilePath path = taken->second.path;

    // THE DETACH, AND THE FIRST TRY AT THE WAY BACK. The reopen closes the
    // device -- which is what takes the converter off a descriptor whose every
    // read is `ENODEV` -- and then opens it again. That open succeeds only if
    // this session is already in front of the user again, which a force pause
    // usually means it is not; when it is not, the device comes back recorded
    // as revoked and `Reclaim` is what finishes the job.
    reopen_.Run(id, path);
    return PauseAnswer::kDeviceIsRevoked;
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

  // THE DESCRIPTOR A RESUME CARRIES IS A LIVE ONE, so the device stops being
  // one an activation has to give back and take again.
  taken->second.liveness = DeviceLiveness::kLive;

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

size_t DrmTakenDevices::Reclaim() {
  // COPIED OUT BEFORE THE FIRST REOPEN, and a whole list this time rather
  // than one device: each reopen runs `OpenInputDevice` synchronously and
  // that comes straight back here to `GiveBack` and `Take`, both of which
  // change `devices_` under any iterator standing in it.
  std::vector<Device> revoked;
  for (const auto& taken : devices_) {
    if (taken.second.liveness == DeviceLiveness::kRevoked) {
      revoked.push_back(taken.second);
    }
  }

  // A LIVE DEVICE IS LEFT ALONE. The reopen stops a converter and builds
  // another one, so asking for every device on every activation would take
  // the desktop's input apart and put it together again for nothing.
  for (const Device& device : revoked) {
    reopen_.Run(device.id, device.path);
  }

  return revoked.size();
}

bool DrmTakenDevices::GiveBack(DeviceNumber number) {
  const auto taken = devices_.find(number);
  if (taken == devices_.end()) {
    return false;
  }

  if (!release_.Run(number)) {
    LOG(ERROR) << "logind refused to take back " << taken->second.path.value()
               << " (" << number.major << ":" << number.minor
               << "), so it cannot be taken again and this device stays dead";
  }

  // FORGOTTEN EVEN WHEN THE RELEASE WAS REFUSED. A device logind would not
  // take back is one this session cannot take again either, and leaving it in
  // the table would have the shutdown name it a second time.
  devices_.erase(taken);
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
