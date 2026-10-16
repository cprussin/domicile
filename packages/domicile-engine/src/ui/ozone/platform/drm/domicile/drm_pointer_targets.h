// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_TARGETS_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_TARGETS_H_

#include <cstdint>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "ui/display/display.h"
#include "ui/events/devices/input_device.h"
#include "ui/events/devices/input_device_event_observer.h"
#include "ui/events/devices/touch_device_transform.h"
#include "ui/events/devices/touchscreen_device.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {

// Returns a transform for each touchscreen a target names, onto its display.
//
// - evdev reads a tablet or touchscreen as a touchscreen: absolute X and Y
//   (`EventDeviceInfo::HasTouchscreen`). Its points arrive in its own range,
//   `TouchscreenDevice::size`.
// - A target names a device by its name or `phys`. The first target that
//   names a device wins.
// - The transform maps that range onto the display's bounds on the engine's
//   desktop, in CRTC pixels, unrotated: the device's axes are the panel's.
//   `DrmWindowHost` then sends the touch to the window that hears it.
// - A target whose display is not in `displays` binds nothing.
//
// See docs/DISPLAYS.md#tablets-and-touchscreens.
std::vector<TouchDeviceTransform> TouchTransformsFor(
    const std::vector<TouchscreenDevice>& touchscreens,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays);

// Returns the display rectangle each mouse a target names covers, by device id.
//
// - An absolute mouse (`AbsoluteMouseEventConverterEvdev`) moves the pointer
//   itself, so it takes its display's bounds on the engine's desktop, in CRTC
//   pixels, rather than a touch transform. A relative mouse never reads its
//   entry.
// - Targets match as in `TouchTransformsFor`.
base::flat_map<int, gfx::Rect> AbsoluteAreasFor(
    const std::vector<InputDevice>& mice,
    const std::vector<DomicilePointerTarget>& targets,
    const std::vector<display::Display>& displays);

// Keeps `DeviceDataManager`'s touch transforms and the absolute mice's areas
// on the compositor's targets.
//
// Reconfigures when the targets change and when a touchscreen or mouse is
// plugged or unplugged. The compositor sends targets after every display
// change, so a modeset needs no observer here.
class DrmPointerTargets : public InputDeviceEventObserver {
 public:
  // The displays on the engine's desktop, as `DrmScreen` reports them.
  using Displays = base::RepeatingCallback<std::vector<display::Display>()>;
  // Takes the absolute mice's areas. `DrmCursor::SetDomicileAbsoluteAreas`.
  using Areas =
      base::RepeatingCallback<void(base::flat_map<int, gfx::Rect> areas)>;

  DrmPointerTargets(Displays displays, Areas areas);
  DrmPointerTargets(const DrmPointerTargets&) = delete;
  DrmPointerTargets& operator=(const DrmPointerTargets&) = delete;
  ~DrmPointerTargets() override;

  // Replaces the targets and applies them.
  void Set(std::vector<DomicilePointerTarget> targets);

  // InputDeviceEventObserver:
  void OnInputDeviceConfigurationChanged(uint8_t input_device_types) override;

 private:
  void Configure();

  const Displays displays_;
  const Areas areas_;
  std::vector<DomicilePointerTarget> targets_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_POINTER_TARGETS_H_
