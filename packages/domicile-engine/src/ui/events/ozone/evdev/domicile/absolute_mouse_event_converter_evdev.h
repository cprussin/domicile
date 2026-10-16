// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_ABSOLUTE_MOUSE_EVENT_CONVERTER_EVDEV_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_ABSOLUTE_MOUSE_EVENT_CONVERTER_EVDEV_H_

#include "base/component_export.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/memory/raw_ptr.h"
#include "ui/events/ozone/evdev/cursor_delegate_evdev.h"
#include "ui/events/ozone/evdev/event_converter_evdev.h"
#include "ui/events/ozone/evdev/event_device_info.h"
#include "ui/gfx/geometry/vector2d.h"

struct input_event;

namespace ui {

class DeviceEventDispatcherEvdev;

// Reads an absolute mouse (`EventDeviceInfo::HasAbsoluteMouse`) as a mouse.
//
// - `ABS_X` and `ABS_Y` move the pointer onto the device's area
//   (`CursorDelegateEvdev::GetDomicileAbsoluteArea`). A move with no button
//   held hovers.
// - Every mouse button is a mouse button, remappable like any mouse's.
// - `REL_WHEEL` and `REL_HWHEEL` scroll, in 120ths of a notch. On an axis
//   with a high-resolution event in the same frame, only that one is read:
//   the kernel sends both for a notch.
//
// See docs/DISPLAYS.md#absolute-mice.
class COMPONENT_EXPORT(EVDEV) AbsoluteMouseEventConverterEvdev
    : public EventConverterEvdev {
 public:
  AbsoluteMouseEventConverterEvdev(base::ScopedFD fd,
                                   base::FilePath path,
                                   int id,
                                   CursorDelegateEvdev* cursor,
                                   const EventDeviceInfo& info,
                                   DeviceEventDispatcherEvdev* dispatcher);
  AbsoluteMouseEventConverterEvdev(const AbsoluteMouseEventConverterEvdev&) =
      delete;
  AbsoluteMouseEventConverterEvdev& operator=(
      const AbsoluteMouseEventConverterEvdev&) = delete;
  ~AbsoluteMouseEventConverterEvdev() override;

  // EventConverterEvdev:
  void OnFileCanReadWithoutBlocking(int fd) override;
  bool HasMouse() const override;

  void ProcessEvents(base::span<const input_event> inputs);

 private:
  void ConvertAbsEvent(const input_event& input);
  void ConvertKeyEvent(const input_event& input);
  void ConvertRelEvent(const input_event& input);
  void FlushEvents(const input_event& input);
  // Moves the pointer to the last reported position, if it changed.
  void Move(const input_event& input);

  const base::ScopedFD input_device_fd_;
  const raw_ptr<CursorDelegateEvdev> cursor_;
  const raw_ptr<DeviceEventDispatcherEvdev> dispatcher_;

  const int x_min_;
  const int x_range_;
  const int y_min_;
  const int y_range_;

  int x_ = 0;
  int y_ = 0;
  bool moved_ = false;
  // This frame's wheel in `MouseWheelEvent` units, 120 a notch with up and
  // left positive: from the notch axes, and from the high-resolution ones.
  gfx::Vector2d notches_;
  gfx::Vector2d hi_res_;
  bool has_hi_res_x_ = false;
  bool has_hi_res_y_ = false;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_ABSOLUTE_MOUSE_EVENT_CONVERTER_EVDEV_H_
