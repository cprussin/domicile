// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_

#include <stddef.h>
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

// A device's major and minor numbers, which logind's `TakeDevice` takes in
// place of a path.
struct DeviceNumber {
  uint32_t major = 0;
  uint32_t minor = 0;

  friend bool operator==(const DeviceNumber&, const DeviceNumber&) = default;
  friend auto operator<=>(const DeviceNumber&, const DeviceNumber&) = default;
};

// Calls `stat(2)`: 0 with `out` filled, or -1 with `errno` set.
int StatDevice(const base::FilePath& path, struct stat* out);

// Injectable `stat(2)`, because unit tests cannot `mknod` a character device
// without root.
using StatCall =
    base::RepeatingCallback<int(const base::FilePath& path, struct stat* out)>;

// Returns the device numbers of `path`, or nothing when it cannot be statted
// or is not a character device. Other file types' numbers would name a
// different device.
std::optional<DeviceNumber> NumberOfDevice(
    const base::FilePath& path,
    const StatCall& stat_call = base::BindRepeating(&StatDevice));

// What the caller owes logind for one `PauseDevice` signal.
enum class PauseAnswer {
  // Type "pause": logind delays the console switch until
  // `PauseDeviceComplete` or its timeout. Sent only on seats without VTs.
  kCompleteIt,
  // Type "force": logind has already revoked the descriptor and wants no
  // answer. The caller should log it, since all input stops.
  kDeviceIsRevoked,
  // Type "gone": the node is unplugged. No answer is owed.
  kNothingToSay,
};

// Whether a descriptor from logind can be read.
//
// Held and live are separate: a "force" pause revokes a held device, and
// `TakeDevice` returns a revoked descriptor to an inactive session. Either
// way the session still holds the device and must release it before taking
// it again.
enum class DeviceLiveness {
  // The descriptor reads. Every take by an active session is live.
  kLive,
  // Every read is `ENODEV` and the converter has stopped. The device works
  // again only after a release and a fresh take.
  kRevoked,
};

// Calls `Session.ReleaseDevice(major, minor)`; true on success. Injectable
// because unit tests have no logind session.
using ReleaseDeviceCall = base::RepeatingCallback<bool(DeviceNumber number)>;

// Asks the evdev device factory to close the device at `path` and reopen it
// under `id`. Injected because the factory owns the opener.
using ReopenDeviceCall =
    base::RepeatingCallback<void(int id, const base::FilePath& path)>;

// Tracks the evdev devices logind gave this session and brings them back
// after a console switch.
//
// A revoked device must be reopened through the evdev factory, which is the
// only place a converter starts. A `ResumeDevice` descriptor is parked here
// until that reopen asks for it, since `TakeDevice` refuses a held device.
// `ResumeDevice` may never come, so `Reclaim` also re-takes revoked devices
// when the session becomes active. See
// docs/TTY-SESSION.md#input-from-logind.
class DrmTakenDevices {
 public:
  DrmTakenDevices(ReleaseDeviceCall release, ReopenDeviceCall reopen);

  DrmTakenDevices(const DrmTakenDevices&) = delete;
  DrmTakenDevices& operator=(const DrmTakenDevices&) = delete;

  // Releases whatever is still held, so logind is not left holding devices
  // after an abnormal teardown.
  ~DrmTakenDevices();

  // Records a device from logind under the evdev factory's `id` and `path`,
  // which a reopen needs.
  void Take(DeviceNumber number,
            int id,
            const base::FilePath& path,
            DeviceLiveness liveness);

  // Returns the descriptor a `ResumeDevice` parked for `path`, once. Invalid
  // when none is parked; the caller then uses `TakeDevice`.
  base::ScopedFD Resumed(const base::FilePath& path);

  // Handles a `PauseDevice` of `type` "pause", "force" or "gone", and returns
  // what logind is owed.
  //
  // logind also sends "gone" for each `ReleaseDevice`, and it can arrive after
  // the re-take. Such an echo is ignored, not treated as an unplug.
  PauseAnswer Pause(DeviceNumber number, std::string_view type);

  // Handles a `ResumeDevice`: parks `descriptor` and asks the factory to
  // reopen the device. Returns false for a device this session never had, or
  // for a resume older than a later release, which revoked its descriptor.
  //
  // logind resumes only devices it holds for this session, so a resume is
  // trusted even when `devices_` lacks the device; `names_` supplies its id
  // and path.
  bool Resume(DeviceNumber number, base::ScopedFD descriptor);

  // Reopens every revoked device through the factory and returns how many.
  // Called when the session becomes active, because logind may revoke every
  // device without ever sending `ResumeDevice`.
  size_t Reclaim();

  // Releases `number` if held, so it can be taken again. False when nothing
  // was held, as on every first open.
  bool GiveBack(DeviceNumber number);

  // Releases every device; true when logind agreed to all of them.
  bool Release();

 private:
  // A device's evdev factory id and path. logind identifies it by
  // `DeviceNumber` instead.
  struct Device {
    int id = 0;
    base::FilePath path;
    DeviceLiveness liveness = DeviceLiveness::kLive;
  };

  ReleaseDeviceCall release_;
  ReopenDeviceCall reopen_;

  // Devices this session holds, from `TakeDevice` until an unplug or a
  // release. Ordered so failures report against the same device each time.
  std::map<DeviceNumber, Device> devices_;

  // The factory's names for every device logind has given this session, held
  // or not. Kept past a release so a `ResumeDevice` that arrives between a
  // release and a re-take can still be reopened. Cleared on unplug or the
  // final `Release`.
  std::map<DeviceNumber, Device> names_;

  // Descriptors parked by `ResumeDevice` for the pending reopen. Keyed by path,
  // which is what `OpenInputDevice` gets.
  std::map<base::FilePath, base::ScopedFD> resumed_;

  // `ReleaseDevice` calls whose "gone" echo has not arrived yet. A count, not
  // a flag, because the evdev thread blocks through each call, so several
  // echoes can queue up. See `Pause`.
  std::map<DeviceNumber, int> released_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_DEVICES_H_
