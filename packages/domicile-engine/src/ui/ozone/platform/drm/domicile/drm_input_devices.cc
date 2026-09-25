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

  // RECORDED WHERE A RELEASE DOES NOT REACH. `devices_` answers "is this
  // device held right now", and a `GiveBack` empties the entry on the way
  // into every re-take. `names_` answers "what does the factory call this
  // number", which stays true for as long as the node is there and is what a
  // `ResumeDevice` arriving in that window has to be answered from.
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
    // A "gone" THIS SESSION ASKED FOR IS NOT THE NODE GOING AWAY, and telling
    // those two apart is the difference between a console switch and a
    // desktop with no keyboard. `ReleaseDevice` frees the `SessionDevice`
    // logind was holding, and logind reports that freeing the way it reports
    // any other: a `PauseDevice` of type "gone" for the number. Every
    // `GiveBack` therefore buys one, and `GiveBack` is on the way into every
    // re-take -- so the echo lands AFTER the `TakeDevice` that replaced the
    // device it names, and forgetting the name there strands a device logind
    // is about to resume.
    //
    // MEASURED ON A CONSOLE SWITCH: thirteen devices force-paused, thirteen
    // "gone" pauses in the 141 microseconds after them, `reclaimed 0 of 0` on
    // the way back, and thirteen `logind resumed device N, which this session
    // never took`. Keyboard and trackpad among them, and no chord left to
    // leave the console with.
    const auto echo = released_.find(number);
    if (echo != released_.end()) {
      // ONE PER RELEASE. A second "gone" with nothing outstanding is the node
      // really going away, and it is answered below.
      echo->second -= 1;
      if (echo->second == 0) {
        released_.erase(echo);
      }
      VLOG(1) << "domicile: input device " << number.major << ":"
              << number.minor
              << " reports gone, which is logind answering the release this "
                 "session asked for; still holding " << devices_.size();
      return PauseAnswer::kNothingToSay;
    }

    // The node is unplugged. There is nothing left to give back, and udev's
    // own removal is what takes the converter down -- so forgetting it is the
    // whole of the handling. The name goes with it: this is the one pause
    // that says the device is not coming back, so a later resume for this
    // number really would be one nothing could reopen.
    devices_.erase(number);
    names_.erase(number);
    VLOG(1) << "domicile: input device " << number.major << ":" << number.minor
            << " is gone; holding " << devices_.size();
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
  // ANSWERED FROM THE NAMES AND NOT FROM THE HOLD. logind sends this only for
  // a device in `s->devices`, so a resume is logind saying it holds this
  // device for this session and has just re-opened it live -- a fact about
  // logind's table, which is the one that decides. Asking `devices_` whether
  // to believe it is how thirteen live descriptors were dropped on the floor
  // in a measured run: every device came up revoked, logind force-paused the
  // whole set a moment later, and by the time the activation's resumes
  // arrived the held table no longer named any of them.
  const auto named = names_.find(number);
  if (named == names_.end()) {
    LOG(ERROR) << "logind resumed device " << number.major << ":"
               << number.minor << ", which this session never took";
    return false;
  }

  // COPIED OUT BEFORE ANYTHING ELSE, because `Take` writes `names_` and the
  // reopen below runs `OpenInputDevice` synchronously, which comes straight
  // back here for `Resumed` -- so nothing may be standing on an iterator into
  // any of the three tables from here down.
  const int id = named->second.id;
  const base::FilePath path = named->second.path;

  const bool forgotten = devices_.find(number) == devices_.end();
  if (forgotten) {
    LOG(WARNING) << "logind resumed input device " << number.major << ":"
                 << number.minor << " (" << path.value()
                 << "), which this session was holding a moment ago and is "
                    "not holding now; taking logind's word for it, because "
                    "the descriptor it sent is a live one and dropping it "
                    "leaves this device dead for the rest of the run";
  }

  // THE DESCRIPTOR A RESUME CARRIES IS A LIVE ONE, so the device stops being
  // one an activation has to give back and take again.
  Take(number, id, path, DeviceLiveness::kLive);

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
    // WHAT logind IS ABOUT TO SAY ABOUT IT, recorded before it says it. A
    // release it agreed to frees the device on its side, and it reports that
    // with a `PauseDevice` of type "gone" -- which arrives after the
    // `TakeDevice` this release is making room for. See `Pause`.
    released_[number] += 1;
  } else {
    LOG(ERROR) << "logind refused to take back " << taken->second.path.value()
               << " (" << number.major << ":" << number.minor
               << "), so it cannot be taken again and this device stays dead";
  }

  // FORGOTTEN EVEN WHEN THE RELEASE WAS REFUSED. A device logind would not
  // take back is one this session cannot take again either, and leaving it in
  // the table would have the shutdown name it a second time. `names_` is left
  // alone: the node has not gone anywhere, and a `ResumeDevice` that lands
  // between this and the `TakeDevice` that follows is answered from it.
  devices_.erase(taken);
  VLOG(1) << "domicile: gave back input device " << number.major << ":"
          << number.minor << "; holding " << devices_.size();
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
  // shutdown that releases explicitly is the ordinary path. The names go with
  // them: this is the session letting go of every device it has, so there is
  // nothing left for a resume to be about.
  devices_.clear();
  names_.clear();
  resumed_.clear();
  // Nothing is owed an answer any more: the tables a stale "gone" could have
  // damaged are empty, and holding the expectation past them would make the
  // first real unplug after a shutdown that did not finish look like an echo.
  released_.clear();
  return every_device_agreed;
}

}  // namespace ui
