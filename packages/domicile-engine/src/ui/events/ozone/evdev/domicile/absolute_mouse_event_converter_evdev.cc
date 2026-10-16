// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/absolute_mouse_event_converter_evdev.h"

#include <errno.h>
#include <linux/input.h>
#include <unistd.h>

#include <utility>

#include "base/compiler_specific.h"
#include "base/logging.h"
#include "base/trace_event/trace_event.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/ozone/evdev/device_event_dispatcher_evdev.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {

AbsoluteMouseEventConverterEvdev::AbsoluteMouseEventConverterEvdev(
    base::ScopedFD fd,
    base::FilePath path,
    int id,
    CursorDelegateEvdev* cursor,
    const EventDeviceInfo& info,
    DeviceEventDispatcherEvdev* dispatcher)
    : EventConverterEvdev(fd.get(),
                          path,
                          id,
                          info.device_type(),
                          info.name(),
                          info.phys(),
                          info.vendor_id(),
                          info.product_id(),
                          info.version()),
      input_device_fd_(std::move(fd)),
      cursor_(cursor),
      dispatcher_(dispatcher),
      x_min_(info.GetAbsMinimum(ABS_X)),
      x_range_(info.GetAbsMaximum(ABS_X) - x_min_ + 1),
      y_min_(info.GetAbsMinimum(ABS_Y)),
      y_range_(info.GetAbsMaximum(ABS_Y) - y_min_ + 1) {}

AbsoluteMouseEventConverterEvdev::~AbsoluteMouseEventConverterEvdev() = default;

void AbsoluteMouseEventConverterEvdev::OnFileCanReadWithoutBlocking(int fd) {
  TRACE_EVENT1(
      "evdev",
      "AbsoluteMouseEventConverterEvdev::OnFileCanReadWithoutBlocking", "fd",
      fd);

  input_event inputs[4];
  const ssize_t read_size = read(fd, inputs, sizeof(inputs));
  if (read_size < 0) {
    if (errno == EINTR || errno == EAGAIN) {
      return;
    }
    if (errno != ENODEV) {
      PLOG(ERROR) << "error reading device " << path_.value();
    }
    Stop();
    return;
  }

  if (IsEnabled()) {
    // SAFETY: `read` filled `read_size` bytes of `inputs`, at most its size.
    ProcessEvents(
        UNSAFE_BUFFERS(base::span(inputs, read_size / sizeof(inputs[0]))));
  }
}

bool AbsoluteMouseEventConverterEvdev::HasMouse() const {
  return true;
}

void AbsoluteMouseEventConverterEvdev::ProcessEvents(
    base::span<const input_event> inputs) {
  for (const input_event& input : inputs) {
    switch (input.type) {
      case EV_ABS:
        ConvertAbsEvent(input);
        break;
      case EV_KEY:
        ConvertKeyEvent(input);
        break;
      case EV_REL:
        ConvertRelEvent(input);
        break;
      case EV_SYN:
        if (input.code == SYN_REPORT) {
          FlushEvents(input);
        }
        break;
    }
  }
}

void AbsoluteMouseEventConverterEvdev::ConvertAbsEvent(
    const input_event& input) {
  switch (input.code) {
    case ABS_X:
      x_ = input.value;
      moved_ = true;
      break;
    case ABS_Y:
      y_ = input.value;
      moved_ = true;
      break;
  }
}

void AbsoluteMouseEventConverterEvdev::ConvertKeyEvent(
    const input_event& input) {
  // 2 is autorepeat, which a button does not have.
  if (input.code < BTN_MOUSE || input.code >= BTN_JOYSTICK ||
      input.value == 2) {
    return;
  }
  // A position in the same frame is where the press was made.
  Move(input);
  dispatcher_->DispatchMouseButtonEvent(MouseButtonEventParams(
      input_device_.id, EF_NONE, cursor_->GetLocation(), input.code,
      input.value == 1, MouseButtonMapType::kMouse,
      PointerDetails(EventPointerType::kMouse),
      TimeTicksFromInputEvent(input)));
}

void AbsoluteMouseEventConverterEvdev::ConvertRelEvent(
    const input_event& input) {
  const int notch = MouseWheelEvent::kWheelDelta;
  // evdev's up is positive, as Chromium's is; its right is positive, where
  // Chromium's left is.
  switch (input.code) {
    case REL_WHEEL:
      notches_.set_y(notches_.y() + input.value * notch);
      break;
    case REL_WHEEL_HI_RES:
      hi_res_.set_y(hi_res_.y() + input.value);
      has_hi_res_y_ = true;
      break;
    case REL_HWHEEL:
      notches_.set_x(notches_.x() - input.value * notch);
      break;
    case REL_HWHEEL_HI_RES:
      hi_res_.set_x(hi_res_.x() - input.value);
      has_hi_res_x_ = true;
      break;
  }
}

void AbsoluteMouseEventConverterEvdev::FlushEvents(const input_event& input) {
  Move(input);
  // The kernel sends a notch on both axes of a high-resolution wheel, so an
  // axis with a high-resolution event this frame takes only that one.
  const gfx::Vector2d wheel(has_hi_res_x_ ? hi_res_.x() : notches_.x(),
                            has_hi_res_y_ ? hi_res_.y() : notches_.y());
  if (!wheel.IsZero()) {
    dispatcher_->DispatchMouseWheelEvent(
        MouseWheelEventParams(input_device_.id, cursor_->GetLocation(), wheel,
                              wheel, TimeTicksFromInputEvent(input)));
  }
  notches_ = gfx::Vector2d();
  hi_res_ = gfx::Vector2d();
  has_hi_res_x_ = false;
  has_hi_res_y_ = false;
}

void AbsoluteMouseEventConverterEvdev::Move(const input_event& input) {
  if (!moved_) {
    return;
  }
  const gfx::Rect area = cursor_->GetDomicileAbsoluteArea(input_device_.id);
  cursor_->MoveCursorTo(gfx::PointF(
      area.x() + area.width() * static_cast<float>(x_ - x_min_) / x_range_,
      area.y() + area.height() * static_cast<float>(y_ - y_min_) / y_range_));
  dispatcher_->DispatchMouseMoveEvent(MouseMoveEventParams(
      input_device_.id, EF_NONE, cursor_->GetLocation(),
      /*ordinal_delta=*/nullptr, PointerDetails(EventPointerType::kMouse),
      TimeTicksFromInputEvent(input)));
  moved_ = false;
}

}  // namespace ui
