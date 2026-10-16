// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_targets.h"

#include <algorithm>
#include <optional>
#include <utility>

#include "ui/events/devices/device_data_manager.h"
#include "ui/gfx/geometry/transform.h"

namespace ui {
namespace {

// The display the first target naming `device` binds it to, if it is one of
// `displays`.
std::optional<display::Display> BoundDisplay(
    const InputDevice& device,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays) {
  const auto target =
      std::ranges::find_if(targets, [&](const DomicilePointerTarget& target) {
        return target.device == device.name || target.device == device.phys;
      });
  if (target == targets.end()) {
    return std::nullopt;
  }
  const auto display =
      std::ranges::find(displays, target->display_id, &display::Display::id);
  if (display == displays.end()) {
    return std::nullopt;
  }
  return *display;
}

}  // namespace

std::vector<TouchDeviceTransform> TouchTransformsFor(
    const std::vector<TouchscreenDevice>& touchscreens,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays) {
  std::vector<TouchDeviceTransform> transforms;
  for (const TouchscreenDevice& device : touchscreens) {
    const std::optional<display::Display> display =
        BoundDisplay(device, targets, displays);
    if (!display.has_value()) {
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

base::flat_map<int, gfx::Rect> AbsoluteAreasFor(
    const std::vector<InputDevice>& mice,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays) {
  base::flat_map<int, gfx::Rect> areas;
  for (const InputDevice& device : mice) {
    const std::optional<display::Display> display =
        BoundDisplay(device, targets, displays);
    if (display.has_value()) {
      areas[device.id] = display->bounds();
    }
  }
  return areas;
}

DrmPointerTargets::DrmPointerTargets(Displays displays, Areas areas)
    : displays_(std::move(displays)), areas_(std::move(areas)) {
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
  if (input_device_types & (InputDeviceEventObserver::kTouchscreen |
                            InputDeviceEventObserver::kMouse)) {
    Configure();
  }
}

void DrmPointerTargets::Configure() {
  DeviceDataManager* devices = DeviceDataManager::GetInstance();
  const std::vector<display::Display> displays = displays_.Run();
  devices->ConfigureTouchDevices(
      TouchTransformsFor(devices->GetTouchscreenDevices(), targets_, displays));
  areas_.Run(AbsoluteAreasFor(devices->GetMouseDevices(), targets_, displays));
}

}  // namespace ui
