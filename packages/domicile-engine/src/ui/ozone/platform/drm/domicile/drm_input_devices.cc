// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

#include <sys/stat.h>
#include <sys/sysmacros.h>

#include <string>
#include <utility>
#include <vector>

#include "base/logging.h"

namespace ui {

namespace {

// logind's `PauseDevice` types.
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

  // `names_` survives `GiveBack`, so a `ResumeDevice` between a release and
  // the re-take can still find the device.
  names_[number] = Device{id, path, liveness};

  VLOG(1) << "domicile: took input device " << number.major << ":"
          << number.minor << " (" << path.value() << "), "
          << (liveness == DeviceLiveness::kLive ? "live" : "revoked")
          << "; holding " << devices_.size();
}

base::ScopedFD DrmTakenDevices::Resumed(const base::FilePath& path) {
  const auto waiting = resumed_.find(path);
  if (waiting == resumed_.end()) {
    return base::ScopedFD();
  }

  // Erase it, or a later hotplug of this path would get a stale descriptor.
  base::ScopedFD descriptor = std::move(waiting->second);
  resumed_.erase(waiting);
  return descriptor;
}

PauseAnswer DrmTakenDevices::Pause(DeviceNumber number,
                                   std::string_view type) {
  if (type == kPauseTypeGone) {
    // logind answers each `ReleaseDevice` with a "gone", which can arrive
    // after the re-take. Treating that echo as an unplug would forget a
    // device logind is about to resume, losing all input on a console
    // switch.
    const auto echo = released_.find(number);
    if (echo != released_.end()) {
      // One echo per release. A "gone" beyond those is a real unplug.
      echo->second -= 1;
      if (echo->second == 0) {
        released_.erase(echo);
      }
      VLOG(2) << "domicile: input device " << number.major << ":"
              << number.minor
              << " reports gone, which is logind answering the release this "
                 "session asked for; still holding " << devices_.size();
      return PauseAnswer::kNothingToSay;
    }

    // Unplugged: forget the device and its name. udev's removal stops the
    // converter.
    devices_.erase(number);
    names_.erase(number);
    VLOG(1) << "domicile: input device " << number.major << ":" << number.minor
            << " is gone; holding " << devices_.size();
    return PauseAnswer::kNothingToSay;
  }

  const auto taken = devices_.find(number);
  if (taken == devices_.end()) {
    // logind pauses only devices it gave us, so log this. Still answer a
    // "pause", or the console switch waits for logind's timeout.
    LOG(ERROR) << "logind paused device " << number.major << ":" << number.minor
               << ", which this session never took";
    return type == kPauseTypePause ? PauseAnswer::kCompleteIt
                                   : PauseAnswer::kNothingToSay;
  }

  if (type == kPauseTypeForce) {
    // logind has already revoked the descriptor but still counts this session
    // as the holder, so keep the device until it is released.
    taken->second.liveness = DeviceLiveness::kRevoked;

    // Copy before the reopen: it re-enters this class synchronously and can
    // invalidate the iterator.
    const int id = taken->second.id;
    const base::FilePath path = taken->second.path;

    // Close the dead converter and try to reopen. While the session is
    // inactive the reopen yields a revoked device, which `Reclaim` fixes
    // later.
    reopen_.Run(id, path);
    return PauseAnswer::kDeviceIsRevoked;
  }

  return type == kPauseTypePause ? PauseAnswer::kCompleteIt
                                 : PauseAnswer::kNothingToSay;
}

bool DrmTakenDevices::Resume(DeviceNumber number, base::ScopedFD descriptor) {
  // Look up `names_`, not `devices_`: logind resumes only devices it holds
  // for this session, even if `devices_` has dropped them.
  const auto named = names_.find(number);
  if (named == names_.end()) {
    LOG(ERROR) << "logind resumed device " << number.major << ":"
               << number.minor << ", which this session never took";
    return false;
  }

  // Copy now: `Take` writes `names_`, and the reopen re-enters this class
  // synchronously.
  const int id = named->second.id;
  const base::FilePath path = named->second.path;

  // An outstanding release means this resume was sent before it, so the
  // release revoked its descriptor. This happens on every activation, since
  // `Reclaim` re-takes devices before their resumes are read. Reopening would
  // replace `Reclaim`'s live converter with a dead one.
  if (released_.contains(number)) {
    VLOG(1) << "domicile: dropping logind's resume of input device "
            << number.major << ":" << number.minor
            << ", sent before this session gave it back and took it again";
    return false;
  }

  const bool forgotten = devices_.find(number) == devices_.end();
  if (forgotten) {
    LOG(ERROR) << "logind resumed input device " << number.major << ":"
               << number.minor << " (" << path.value()
               << "), which this session was holding a moment ago and is "
                  "not holding now; taking logind's word for it, because "
                  "the descriptor it sent is a live one and dropping it "
                  "leaves this device dead for the rest of the run";
  }

  // A resumed descriptor is live, so `Reclaim` can skip this device.
  Take(number, id, path, DeviceLiveness::kLive);

  resumed_[path] = std::move(descriptor);

  // Also reopen devices that were never paused: logind resumes every device
  // on activation, and its descriptor wins.
  reopen_.Run(id, path);
  return true;
}

size_t DrmTakenDevices::Reclaim() {
  // Copy the list first: each reopen re-enters `GiveBack` and `Take`, which
  // modify `devices_`.
  std::vector<Device> revoked;
  for (const auto& taken : devices_) {
    if (taken.second.liveness == DeviceLiveness::kRevoked) {
      revoked.push_back(taken.second);
    }
  }

  // Skip live devices; reopening them would rebuild converters for nothing.
  for (const Device& device : revoked) {
    reopen_.Run(device.id, device.path);
  }

  VLOG(1) << "domicile: reclaimed " << revoked.size() << " of "
          << devices_.size() << " held input device(s)";
  return revoked.size();
}

bool DrmTakenDevices::GiveBack(DeviceNumber number) {
  const auto taken = devices_.find(number);
  if (taken == devices_.end()) {
    return false;
  }

  if (release_.Run(number)) {
    // Expect logind's "gone" echo for this release. See `Pause`.
    released_[number] += 1;
  } else {
    LOG(ERROR) << "logind refused to take back " << taken->second.path.value()
               << " (" << number.major << ":" << number.minor
               << "), so it cannot be taken again and this device stays dead";
  }

  // Forget it even if the release failed, so shutdown doesn't release it
  // twice. Keep `names_` for a `ResumeDevice` before the re-take.
  devices_.erase(taken);
  VLOG(2) << "domicile: gave back input device " << number.major << ":"
          << number.minor << "; holding " << devices_.size();
  return true;
}

bool DrmTakenDevices::Release() {
  // Release every device even after a failure, so none stays with this
  // session after it exits.
  bool every_device_agreed = true;
  for (const auto& [number, device] : devices_) {
    if (!release_.Run(number)) {
      LOG(ERROR) << "logind refused to take back " << device.path.value()
                 << " (" << number.major << ":" << number.minor << ")";
      every_device_agreed = false;
    }
  }

  // Clear everything, since the destructor calls this again.
  devices_.clear();
  names_.clear();
  resumed_.clear();
  // Drop pending echoes, or a later real unplug would look like one.
  released_.clear();
  return every_device_agreed;
}

}  // namespace ui
