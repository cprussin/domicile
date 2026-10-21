// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_

#include <optional>
#include <string>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "ui/events/ozone/evdev/input_device_opener.h"
#include "ui/events/ozone/evdev/input_device_opener_evdev.h"
#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"
#include "ui/ozone/platform/drm/domicile/drm_logind_session.h"

namespace ui {

// Takes evdev descriptors from logind's `Session.TakeDevice` instead of
// opening the nodes.
//
// logind's uaccess rules don't grant the session user keyboards or mice, and
// the `input` group would give every process of that user permanent keyboard
// access. Other Wayland compositors use `TakeDevice` too. Failure is fatal:
// the fallback would fail anyway. Only the DRM platform uses this.
//
// logind revokes devices on a console switch; `DrmTakenDevices` reopens them.
// This follows the session's `Active` property as well as `ResumeDevice`,
// which may never arrive. `DrmVtSwitcher` watches the same property on the UI
// thread; this needs it on the evdev thread.
//
// Lives on the evdev thread. Nothing here blocks it: each device's calls
// answer later, so the devices already open keep reading through a console
// switch. See docs/TTY-SESSION.md#the-d-bus-thread.
class DrmLogindInput : public InputDeviceOpenerEvdev,
                       public DrmLogindInputListener {
 public:
  // `session` must outlive this. It holds control of the session, which
  // `TakeDevice` needs.
  explicit DrmLogindInput(DrmLogindSession* session);

  DrmLogindInput(const DrmLogindInput&) = delete;
  DrmLogindInput& operator=(const DrmLogindInput&) = delete;

  ~DrmLogindInput() override;

  // DrmLogindInputListener:
  void OnPauseDevice(DeviceNumber number, const std::string& type) override;
  void OnResumeDevice(DeviceNumber number, base::ScopedFD descriptor) override;
  void OnSessionChanged() override;

 private:
  // Takes the device from logind instead of opening it.
  void OpenDeviceFd(const OpenInputDeviceParams& params,
                    OpenedDeviceFd opened) override;

  // Gives the device back if held and asks logind for it. `attempt` counts
  // the takes answered revoked while the session said it was active.
  void Take(DeviceNumber number,
            int id,
            const base::FilePath& path,
            int attempt,
            OpenedDeviceFd opened);
  void OnTaken(DeviceNumber number,
               int id,
               const base::FilePath& path,
               int attempt,
               OpenedDeviceFd opened,
               std::optional<TakenDevice> taken);
  // Handles a take answered revoked, once logind says whether the session is
  // active.
  void OnTakenRevoked(DeviceNumber number,
                      int id,
                      const base::FilePath& path,
                      int attempt,
                      OpenedDeviceFd opened,
                      bool active);

  void OnSessionActive(bool active);

  // Runs the factory's reopen callback. An indirection because `devices_` is
  // built before the factory hands that callback over.
  void ReopenDevice(int id, const base::FilePath& path);

  void ReleaseDevice(DeviceNumber number, ReleaseAnswer answered);

  const raw_ptr<DrmLogindSession> session_;

  DrmTakenDevices devices_;

  base::WeakPtrFactory<DrmLogindInput> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_
