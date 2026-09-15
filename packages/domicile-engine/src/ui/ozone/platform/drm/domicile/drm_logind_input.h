// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// The evdev descriptors, taken from logind rather than opened.
//
// WHY THE `open` CANNOT WORK. logind's `70-uaccess.rules` puts an ACL on `drm
// card*` and `renderD*` for the user of the active session, and among input
// devices it tags only `ID_INPUT_JOYSTICK`. A keyboard or a mouse keeps its
// group-owned mode, so on an ordinary desktop the card opens and every
// `/dev/input/event*` is `Permission denied`. Putting the user in the `input`
// group would make the bare `open` work and is rejected twice over: it is a
// standing keyboard grant to every process that user runs, and it revokes
// nothing on a console switch. No other Wayland compositor asks for it --
// every one of them takes the descriptor from
// `org.freedesktop.login1.Session.TakeDevice`, which is what this does.
//
// NO FALLBACK TO `open`. A session that is missing, or a `TakeControl` some
// other process already holds, is a real failure and is fatal here. A desktop
// that quietly comes up deaf is the bug this exists to remove, and the `open`
// it would fall back to is the one that cannot work. Nested and headless runs
// do not use evdev at all, so the DRM platform is the only caller.
//
// A CONSOLE SWITCH ROUND TRIP KEEPS INPUT ALIVE, and that costs more than
// swapping the descriptor. logind `EVIOCREVOKE`s what it paused, the converter
// answers the resulting `ENODEV` read by stopping its watch, and only
// `InputDeviceFactoryEvdev::AttachInputDevice` ever starts one -- so a
// `ResumeDevice` parks its descriptor and asks the factory to close the device
// and open it again. See `DrmTakenDevices`.
//
// THE BRIDGE, NAMED. `InputDeviceOpener::OpenInputDevice` is synchronous and
// runs on the evdev thread; `TakeDevice` is a D-Bus call, which Chromium's
// `dbus::Bus` will only issue from the thread that owns the connection. The
// bus is therefore created HERE, on the evdev thread, with a thread-pool
// single-thread runner for its own -- the same shape `dbus_thread_linux`
// builds its shared buses with. That makes the evdev thread the bus's ORIGIN
// thread, so `ConnectToSignal` and every signal callback land on it with no
// hop and no lock, and leaves exactly one crossing: `CallMethodAndBlock` must
// run on the D-Bus thread, so it is posted there and this thread waits on a
// `base::WaitableEvent` for the answer.
//
// The evdev thread is where a `base::Thread` runs a `MessagePumpType::UI`
// pump, so `CurrentIOThread::IsSet()` is false there and `base::Thread` gives
// it no `FileDescriptorWatcher` (`base/threading/thread.cc`) -- which is why
// the bus cannot simply be run on this thread with no D-Bus thread at all,
// and why the crossing is a real one rather than a choice. Blocking is what
// this call already did: upstream's `open` and the four `EVIOCG*` ioctls
// behind `EventDeviceInfo::Initialize` are synchronous on this same thread.
class DrmLogindInput : public InputDeviceOpenerEvdev {
 public:
  // CONSTRUCTED ON THE EVDEV THREAD, which is what makes that thread the
  // bus's origin. Finds this process's session, takes control of it, and
  // subscribes to the pause half before taking anything -- in that order,
  // because a pause that arrives between the take and the subscribe is one
  // this session would never answer.
  DrmLogindInput();

  DrmLogindInput(const DrmLogindInput&) = delete;
  DrmLogindInput& operator=(const DrmLogindInput&) = delete;

  ~DrmLogindInput() override;

 private:
  // The one thing this changes about opening an evdev node.
  base::ScopedFD OpenDeviceFd(const OpenInputDeviceParams& params) override;

  // Runs the factory's own reopen, which it hands over after construction --
  // so this is an indirection rather than the callback itself: `devices_` is
  // built in the member list, before the factory this belongs to exists.
  void ReopenDevice(int id, const base::FilePath& path);

  // Runs `call` on the bus's thread and blocks this one until it answers.
  std::unique_ptr<dbus::Response> CallAndBlock(dbus::ObjectProxy* proxy,
                                               dbus::MethodCall* call);

  // Subscribes on the bus's thread and blocks this one until it is done, so
  // that a signal cannot be missed between subscribing and taking a device.
  bool ConnectAndBlock(const std::string& signal,
                       dbus::ObjectProxy::SignalCallback callback);

  void OnPauseDevice(dbus::Signal* signal);
  void OnResumeDevice(dbus::Signal* signal);

  bool ReleaseDevice(DeviceNumber number);

  scoped_refptr<dbus::Bus> bus_;
  raw_ptr<dbus::ObjectProxy> session_ = nullptr;

  // Declared last so that the descriptors are given back before the bus that
  // has to carry the giving back is torn down.
  DrmTakenDevices devices_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_INPUT_H_
