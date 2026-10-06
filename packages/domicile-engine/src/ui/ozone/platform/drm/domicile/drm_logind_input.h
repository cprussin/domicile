// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_

#include <memory>
#include <string>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_proxy.h"
#include "ui/events/ozone/evdev/input_device_opener.h"
#include "ui/events/ozone/evdev/input_device_opener_evdev.h"
#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

namespace ui {

// Takes evdev descriptors from logind's `Session.TakeDevice` instead of
// opening the nodes.
//
// logind's uaccess rules don't grant the session user keyboards or mice, and
// the `input` group would give every process of that user permanent keyboard
// access. Other Wayland compositors use `TakeDevice` too. Failure is fatal:
// the `open` fallback would fail anyway. Only the DRM platform uses this.
//
// logind revokes devices on a console switch; `DrmTakenDevices` reopens them.
// This follows the session's `Active` property as well as `ResumeDevice`,
// which may never arrive. `DrmVtSwitcher` watches the same property, but on
// its own bus on the UI thread; this needs it on the evdev thread.
//
// The bus is created on the evdev thread, so signals arrive there without
// locks. Method calls block on the bus's own `DEDICATED` thread; a shared one
// would delay other buses' signals and crash the GPU process on a console
// switch. See docs/TTY-SESSION.md#the-d-bus-thread.
class DrmLogindInput : public InputDeviceOpenerEvdev {
 public:
  // Must run on the evdev thread, which becomes the bus's origin thread.
  // Takes control of this process's session and subscribes to pauses before
  // taking any device, so no pause is missed.
  DrmLogindInput();

  DrmLogindInput(const DrmLogindInput&) = delete;
  DrmLogindInput& operator=(const DrmLogindInput&) = delete;

  ~DrmLogindInput() override;

 private:
  // Takes the device from logind instead of opening it.
  base::ScopedFD OpenDeviceFd(const OpenInputDeviceParams& params) override;

  // Runs the factory's reopen callback. An indirection because `devices_` is
  // built before the factory hands that callback over.
  void ReopenDevice(int id, const base::FilePath& path);

  // Runs `call` on the bus's thread and blocks this one until it answers.
  std::unique_ptr<dbus::Response> CallAndBlock(dbus::ObjectProxy* proxy,
                                               dbus::MethodCall* call);

  // Subscribes on the bus's thread and blocks until done, so no signal is
  // missed between subscribing and taking a device.
  bool ConnectAndBlock(const std::string& interface,
                       const std::string& signal,
                       dbus::ObjectProxy::SignalCallback callback);

  void OnPauseDevice(dbus::Signal* signal);
  void OnResumeDevice(dbus::Signal* signal);

  // Handles a session property change; only `Active` matters.
  void OnPropertiesChanged(dbus::Signal* signal);

  // Asks logind whether this session is active. Queried, because
  // `PropertiesChanged` may list a property as invalidated without a value.
  bool SessionIsActive();

  bool ReleaseDevice(DeviceNumber number);

  scoped_refptr<dbus::Bus> bus_;
  raw_ptr<dbus::ObjectProxy> session_ = nullptr;

  // Declared last so devices are released before the bus is torn down.
  DrmTakenDevices devices_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_
