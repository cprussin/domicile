// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/touch_edge_swipes.h"

#include <algorithm>
#include <optional>
#include <utility>

#include "base/functional/bind.h"
#include "ui/display/types/display_constants.h"
#include "ui/events/devices/device_data_manager.h"
#include "ui/events/devices/touchscreen_device.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect_f.h"

namespace ui {
namespace {

gfx::PointF Transformed(int device_id, gfx::PointF point) {
  float x = point.x();
  float y = point.y();
  DeviceDataManager::GetInstance()->ApplyTouchTransformer(device_id, &x, &y);
  return gfx::PointF(x, y);
}

// The part of the desk `device_id` covers -- its display, for a device bound
// to one -- in the space its transformed touches land in.
std::optional<gfx::RectF> Covered(int device_id) {
  DeviceDataManager* devices = DeviceDataManager::GetInstance();
  if (devices->GetTargetDisplayForTouchDevice(device_id) ==
      display::kInvalidDisplayId) {
    return std::nullopt;
  }
  const std::vector<TouchscreenDevice>& screens =
      devices->GetTouchscreenDevices();
  auto found = std::ranges::find(screens, device_id, &TouchscreenDevice::id);
  if (found == screens.end() || found->size.IsEmpty()) {
    return std::nullopt;
  }
  // Two opposite corners, which a turned display swaps about.
  const gfx::PointF one = Transformed(device_id, gfx::PointF());
  const gfx::PointF two = Transformed(
      device_id, gfx::PointF(found->size.width(), found->size.height()));
  return gfx::BoundingRect(one, two);
}

}  // namespace

TouchEdgeSwipes::Device::Device() = default;
TouchEdgeSwipes::Device::~Device() = default;

TouchEdgeSwipes::TouchEdgeSwipes(Dispatch dispatch)
    : dispatch_(std::move(dispatch)) {}

TouchEdgeSwipes::~TouchEdgeSwipes() = default;

void TouchEdgeSwipes::Touch(const TouchEventParams& params) {
  auto found = devices_.find(params.device_id);
  if (found == devices_.end()) {
    if (params.type != EventType::kTouchPressed) {
      dispatch_.Run(params);
      return;
    }
    found =
        devices_.emplace(params.device_id, std::make_unique<Device>()).first;
  }
  Device& device = *found->second;
  const std::optional<gfx::RectF> covered = Covered(params.device_id);
  // A touchscreen with no display has no edges: a rect with no area.
  const EdgeSwipe::Verdict verdict = device.swipe.Touch(
      params.type, params.slot, Transformed(params.device_id, params.location),
      covered.value_or(gfx::RectF()), params.timestamp);
  switch (verdict) {
    case EdgeSwipe::Verdict::kDispatch:
      dispatch_.Run(params);
      break;
    case EdgeSwipe::Verdict::kWithhold:
      device.withheld.push_back(params);
      if (!device.wait.IsRunning()) {
        // From now, not from the touch's own time, which can be behind it.
        // Unretained: `this` owns the device, which owns the timer.
        device.wait.Start(
            FROM_HERE, kEdgeSwipeWait,
            base::BindOnce(&TouchEdgeSwipes::Expire, base::Unretained(this),
                           params.device_id));
      }
      break;
    case EdgeSwipe::Verdict::kRelease:
      Release(device);
      dispatch_.Run(params);
      break;
    case EdgeSwipe::Verdict::kTaken:
      device.wait.Stop();
      device.withheld.clear();
      break;
  }
}

void TouchEdgeSwipes::Expire(int device_id) {
  auto found = devices_.find(device_id);
  if (found == devices_.end()) {
    return;
  }
  found->second->swipe.Expire();
  Release(*found->second);
}

void TouchEdgeSwipes::Release(Device& device) {
  device.wait.Stop();
  std::vector<TouchEventParams> withheld = std::move(device.withheld);
  device.withheld.clear();
  for (const TouchEventParams& params : withheld) {
    dispatch_.Run(params);
  }
}

}  // namespace ui
