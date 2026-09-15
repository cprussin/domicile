// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_

#include <stdint.h>
#include <sys/stat.h>

#include <compare>
#include <map>
#include <optional>
#include <string_view>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"

namespace ui {

// The pair `org.freedesktop.login1.Session.TakeDevice` is addressed by. Not a
// path: logind takes two numbers and has no notion of which node they came
// from, so resolving the one to the other is this process's job.
struct DeviceNumber {
  uint32_t major = 0;
  uint32_t minor = 0;

  friend bool operator==(const DeviceNumber&, const DeviceNumber&) = default;
  friend auto operator<=>(const DeviceNumber&, const DeviceNumber&) = default;
};

// The real `stat(2)`: 0 with `out` filled, or -1 with `errno` set.
int StatDevice(const base::FilePath& path, struct stat* out);

// `stat(2)`, injected, because a unit test cannot `mknod` a character device
// and a test that ran only as root would not run.
using StatCall =
    base::RepeatingCallback<int(const base::FilePath& path, struct stat* out)>;

// The numbers logind wants for `path`, or nothing when the path cannot be
// statted or is not a character device -- the second is not a pedantry, since
// a block device carries the same two numbers in a different space, so those
// of a regular file or a directory would ask logind for a device that is not
// the one on the path, if it is anything at all.
std::optional<DeviceNumber> NumberOfDevice(
    const base::FilePath& path,
    const StatCall& stat_call = base::BindRepeating(&StatDevice));

// What answering one `PauseDevice` signal requires of the caller.
enum class PauseAnswer {
  // Type "pause": logind is holding the console switch open until it is told
  // `PauseDeviceComplete`, and gives up only after its own timeout.
  kCompleteIt,
  // Types "force" and "gone": logind saying what it has already done. Neither
  // is answered, and answering them is not part of the protocol.
  kNothingToSay,
};

// `Session.ReleaseDevice(major, minor)`; true when logind agreed. Injected for
// the reason `DrmMasterCall` is: the call needs a session this process holds
// control of, which a unit test does not have.
using ReleaseDeviceCall = base::RepeatingCallback<bool(DeviceNumber number)>;

// Asks the evdev device factory to close the device at `path` and open it
// again under `id` -- `RemoveInputDevice` then `AddInputDevice`. Injected
// because the factory is the thing that owns the opener this runs in.
using ReopenDeviceCall =
    base::RepeatingCallback<void(int id, const base::FilePath& path)>;

// Every evdev device logind handed this session, and the way each of them
// comes back from a console switch.
//
// THE RESUME IS A REOPEN, NOT A REPAIR, and that is the whole shape of this
// class. `PauseDevice` is logind `EVIOCREVOKE`ing the descriptor it passed, so
// the converter reading that descriptor gets `ENODEV` and answers it with
// `Stop()` -- and nothing re-arms that watch. Replacing the descriptor under
// the converter cannot either: `dup2` closes the revoked description, and the
// kernel drops an epoll registration when the description behind a number is
// closed. `InputDeviceFactoryEvdev::AttachInputDevice` is the ONLY caller of
// `EventConverterEvdev::Start()`, so the device has to go back through the
// factory, which is what `ReopenDeviceCall` is.
//
// Left undone, a desktop would be dead after its first `Ctrl+Alt+F<n>` round
// trip -- worse than the `input` group this replaces, whose descriptors are
// never revoked at all.
//
// THE DESCRIPTOR IS PARKED, NOT PASSED. The reopen goes back through
// `OpenInputDevice`, which asks for a descriptor rather than being handed one,
// and `TakeDevice` for a device this session already holds is refused. So the
// one the `ResumeDevice` signal carried is held here until that reopen asks
// for it, and handed over exactly once.
class DrmTakenDevices {
 public:
  DrmTakenDevices(ReleaseDeviceCall release, ReopenDeviceCall reopen);

  DrmTakenDevices(const DrmTakenDevices&) = delete;
  DrmTakenDevices& operator=(const DrmTakenDevices&) = delete;

  // Releases whatever is still held, so that a session torn down by an
  // exception path does not leave logind holding devices for it.
  ~DrmTakenDevices();

  // Records a device logind handed over, under the id and path the evdev
  // factory knows it by -- which are what a reopen has to name.
  void Take(DeviceNumber number, int id, const base::FilePath& path);

  // The descriptor a `ResumeDevice` left for `path`, handed over once. Invalid
  // when there is none, which is every ordinary open: a first scan or a real
  // hotplug has nothing waiting and goes to `TakeDevice`.
  base::ScopedFD Resumed(const base::FilePath& path);

  // Follows a `PauseDevice`, and answers what logind is owed for it. `type` is
  // logind's own: "pause", "force" or "gone".
  PauseAnswer Pause(DeviceNumber number, std::string_view type);

  // Follows a `ResumeDevice`: parks `descriptor` for the device's path and
  // asks the factory to close the device and open it again, which is what
  // re-arms the watch. False when this session never took the device -- the
  // one case with no path and no id to reopen under, and one where asking the
  // factory would build a converter on a descriptor nobody owns.
  bool Resume(DeviceNumber number, base::ScopedFD descriptor);

  // Gives every device back, and answers whether logind agreed to all of them.
  bool Release();

 private:
  // What the evdev factory knows a device by, which is not what logind knows
  // it by -- hence the table.
  struct Device {
    int id = 0;
    base::FilePath path;
  };

  ReleaseDeviceCall release_;
  ReopenDeviceCall reopen_;

  // Every device this session still holds. Membership IS the state: a device
  // is here from the `TakeDevice` that produced it until either a
  // `PauseDevice` of type "gone" -- the node unplugged, so there is nothing
  // left to release and udev's own removal takes the converter down -- or the
  // release that gives it back.
  //
  // Ordered, so that a failure is reported against the same device every time.
  std::map<DeviceNumber, Device> devices_;

  // Descriptors a `ResumeDevice` left, waiting for the reopen it asked for.
  // Keyed by path because that is what `OpenInputDevice` comes back with.
  std::map<base::FilePath, base::ScopedFD> resumed_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_
