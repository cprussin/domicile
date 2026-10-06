// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_

#include <memory>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "ui/display/types/display_configuration_params.h"
#include "ui/display/types/native_display_delegate.h"
#include "ui/display/types/native_display_observer.h"
#include "ui/ozone/public/ozone_platform.h"

namespace display {
class DisplaySnapshot;
}

namespace ui {

class DrmScreen;

// Builds the modeset request for the connected displays. A free function so
// it can be unit tested.
//
// A snapshot with no native mode is skipped. `DisplaysFromSnapshots` gives one
// a fallback because a window must land somewhere, but a modeset must not ask
// a CRTC for a mode the hardware never advertised.
//
// `layout` is the compositor's display config, which arrives over the
// engine's C ABI because this process holds DRM master. When it is empty,
// every readable connector lights, placed by `OriginsForLayout`. When it is
// not, connectors it does not name stay dark; a newly plugged monitor lights
// once the compositor answers the hotplug this modeset triggers. See
// docs/DISPLAYS.md#which-connectors-light.
std::vector<display::DisplayConfigurationParams> ModesetParamsFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// Describes a display reading in one log line, including each native mode.
//
// The mode matters because the browser window must match it exactly
// (`ScreenManager::FindWindowAt` compares whole rectangles); otherwise every
// page flip is dropped. Chromium's own modeset logging needs
// `--vmodule=screen_manager=1`; see docs/TTY-DEBUGGING.md#seeing-a-modeset.
std::string DescribeSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots);

// Whether a modeset for `wanted` differs from the last confirmed one, `asked`.
//
// Each `Configure` makes the kernel emit a udev CHANGE, which triggers another
// reading. Skipping a request that matches the last confirmed one stops that
// loop. A real hotplug changes the reading and gets through.
//
// Compare only against confirmed modesets. The first `Configure` goes out
// before the GPU process has a DRM device, so it reaches nothing; recording it
// would suppress the identical reading that later does work.
bool ModesetWouldChangeAnything(
    const std::vector<display::DisplayConfigurationParams>& asked,
    const std::vector<display::DisplayConfigurationParams>& wanted);

// Drives `NativeDisplayDelegate` to modeset off ChromeOS, where
// `DisplayConfigurator` is unavailable. See
// docs/architecture/A-DESKTOP-ON-A-TTY.md#the-modeset-driver.
//
// It passes `DrmScreen` the same snapshots it modesets from, so the display
// list and the lit CRTCs come from one reading.
class DrmModeset : public display::NativeDisplayObserver {
 public:
  DrmModeset(std::unique_ptr<display::NativeDisplayDelegate> delegate,
             DrmScreen* screen);

  DrmModeset(const DrmModeset&) = delete;
  DrmModeset& operator=(const DrmModeset&) = delete;

  ~DrmModeset() override;

  // Initializes the delegate and requests the displays. Modesets when they
  // arrive and on every hotplug.
  void Start();

  // Sets the compositor's display layout; see `ModesetParamsFromSnapshots`.
  //
  // Re-reads the displays because no snapshots are held between callbacks,
  // and the screen and the modeset must come from one reading.
  void SetLayout(std::vector<DomicileDisplayLayout> layout);

  // Modesets again even if the reading is unchanged.
  //
  // After a resume or a VT switch back, the CRTCs are reset or programmed by
  // another process, but the connectors report the same as before, so
  // `ModesetWouldChangeAnything` would skip the modeset. This clears the last
  // confirmation so the next reading gets through. Called by `DrmSleep` and
  // `DrmVtSwitcher`.
  void Relight();

  // display::NativeDisplayObserver:
  void OnConfigurationChanged() override;
  void OnDisplaySnapshotsInvalidated() override;

 private:
  void OnDisplaysReceived(
      const std::vector<raw_ptr<display::DisplaySnapshot,
                                VectorExperimental>>& snapshots);

  const std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  const raw_ptr<DrmScreen> screen_;  // Not owned; outlives this.
  // The last modeset the hardware confirmed. See
  // `ModesetWouldChangeAnything`.
  std::vector<display::DisplayConfigurationParams> confirmed_;
  // The compositor's last layout; empty until it sends one.
  std::vector<DomicileDisplayLayout> layout_;
  // Whether `delegate_->Configure` is still running. A real modeset is
  // answered on a later task, so an answer that arrives while this is true
  // came from this process, not the hardware. See `OnDisplaysReceived`.
  bool inside_configure_ = false;
  base::WeakPtrFactory<DrmModeset> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
