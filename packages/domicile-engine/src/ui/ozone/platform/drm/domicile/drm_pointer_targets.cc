// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_targets.h"

#include <algorithm>
#include <utility>

#include "ui/events/devices/device_data_manager.h"
#include "ui/gfx/geometry/transform.h"

namespace ui {

std::vector<TouchDeviceTransform> TouchTransformsFor(
    const std::vector<TouchscreenDevice>& touchscreens,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays) {
  std::vector<TouchDeviceTransform> transforms;
  for (const TouchscreenDevice& device : touchscreens) {
    const auto target =
        std::ranges::find_if(targets, [&](const DomicilePointerTarget& target) {
          return target.device == device.name || target.device == device.phys;
        });
    if (target == targets.end()) {
      continue;
    }
    const auto display =
        std::ranges::find(displays, target->display_id, &display::Display::id);
    if (display == displays.end()) {
      continue;
    }
    const gfx::Rect& bounds = display->bounds();
    TouchDeviceTransform transform;
    transform.device_id = device.id;
    transform.display_id = display->id();
    transform.transform =
        gfx::Transform::MakeTranslation(bounds.x(), bounds.y());
    transform.transform.Scale(
        static_cast<float>(bounds.width()) / device.size.width(),
        static_cast<float>(bounds.height()) / device.size.height());
    transforms.push_back(std::move(transform));
  }
  return transforms;
}

DrmPointerTargets::DrmPointerTargets(Displays displays)
    : displays_(std::move(displays)) {
  DeviceDataManager::GetInstance()->AddObserver(this);
}

DrmPointerTargets::~DrmPointerTargets() {
  DeviceDataManager::GetInstance()->RemoveObserver(this);
}

void DrmPointerTargets::Set(std::vector<DomicilePointerTarget> targets) {
  targets_ = std::move(targets);
  Configure();
}

void DrmPointerTargets::OnInputDeviceConfigurationChanged(
    uint8_t input_device_types) {
  if (input_device_types & InputDeviceEventObserver::kTouchscreen) {
    Configure();
  }
}

void DrmPointerTargets::Configure() {
  DeviceDataManager* devices = DeviceDataManager::GetInstance();
  devices->ConfigureTouchDevices(TouchTransformsFor(
      devices->GetTouchscreenDevices(), targets_, displays_.Run()));
}

}  // namespace ui
